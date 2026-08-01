import { CARTRIDGE_FORMAT_VERSION, CARTRIDGE_LIMITS, DANGEROUS_EXTENSIONS, MANIFEST_VERSION, REQUIRED_CARTRIDGE_FILES } from "./constants";
import { isCartridgeFormatCompatible, isRuntimeCompatible } from "./compatibility";
import { assetTypeDisplayLabel, assetTypeMatchesExpected, isImageLikeAssetType } from "./assetTaxonomy";
import type { AssetType, CartridgeValidationResult, ChecksumManifest, GalleryManifest, GameCommand, GameManifest, RuntimeScript, ValidationIssue } from "./types";
import { validateCharacterAnimationConfig } from "../animation/characterAnimation";
import { validateVisualTransitionConfig } from "../animation/visualTransition";
import { validateCameraCommand } from "../camera/cameraMotion";
import { MAX_SPRITE_SCALE, MIN_SPRITE_SCALE } from "./spriteScale";
import { MAX_SPRITE_LAYER, MIN_SPRITE_LAYER, isValidSpriteLayer } from "./spriteLayer";

const MIN_SPEAKER_FOCUS_SCALE = 1;
const MAX_SPEAKER_FOCUS_SCALE = 1.15;
const MIN_SPEAKER_FOCUS_DURATION_MS = 80;
const MAX_SPEAKER_FOCUS_DURATION_MS = 1000;
const MAX_VIDEO_FADE_MS = 10_000;

function splitIssues(issues: ValidationIssue[]): CartridgeValidationResult {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

function issue(code: string, message: string, severity: "error" | "warning" = "error", path?: string): ValidationIssue {
  return { code, message, severity, path };
}

function scenesOf(script: RuntimeScript): RuntimeScript["scenes"] {
  return Array.isArray(script.scenes) ? script.scenes : [];
}

function collectCharacterIds(script: RuntimeScript): Set<string> {
  const ids = new Set((script.characters ?? []).map((character) => character.character_id.trim()).filter(Boolean));
  for (const scene of scenesOf(script)) {
    for (const command of Array.isArray(scene.commands) ? scene.commands : []) {
      if ((command.type === "dialog" || command.type === "sprite") && command.character_id.trim()) {
        ids.add(command.character_id.trim());
      }
    }
  }
  return ids;
}

function spriteTargetCharacterId(target: string | undefined): string | undefined {
  const trimmed = target?.trim();
  if (!trimmed?.toLowerCase().startsWith("sprite:")) return undefined;
  const id = trimmed.slice("sprite:".length).trim();
  return id || "selected";
}

const manifestFieldLabels: Record<string, string> = {
  manifest_version: "卡带清单版本",
  cartridge_version: "卡带格式版本",
  runtime_version: "GameCLI 版本要求",
  game_id: "游戏编号",
  title: "游戏标题",
  author: "作者",
  version: "游戏版本",
  entry_script: "入口剧本文件",
  entry_scene_id: "入口场景编号"
};

function duplicateSceneDetails(script: RuntimeScript): string {
  const groups = new Map<string, string[]>();
  for (const scene of scenesOf(script)) {
    const label = scene.title?.trim() || scene.scene_id;
    groups.set(scene.scene_id, [...(groups.get(scene.scene_id) ?? []), label]);
  }
  return [...groups.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([id, labels]) => `${id}：${labels.join("、")}`)
    .join("；");
}

export function validateManifest(manifest: GameManifest): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  for (const field of ["manifest_version", "cartridge_version", "runtime_version", "game_id", "title", "author", "version", "entry_script", "entry_scene_id"] as const) {
    if (!manifest[field]) {
      issues.push(issue("manifest_required", `${manifestFieldLabels[field]}缺失（${field}）：原因：manifest.json 没有提供这个必要字段。影响：GameCLI 无法确认卡带身份、入口或兼容性。解决方案：请回到编辑器重新导出卡带；如果是手工制作卡带，请在 manifest.json 中补全该字段。`, "error", `manifest.${field}`));
    }
  }
  if (!Array.isArray(manifest.assets)) {
    issues.push(issue("manifest_assets", "素材清单格式错误（assets）：原因：manifest.json 中 assets 必须是数组。影响：GameCLI 无法检查背景、立绘、音乐等素材。解决方案：请重新导出卡带，或把 assets 修正为数组。", "error", "manifest.assets"));
  }
  if (manifest.manifest_version && manifest.manifest_version !== MANIFEST_VERSION) {
    issues.push(issue("manifest_version", `清单版本可能不兼容（manifest_version）：当前为 ${manifest.manifest_version}，当前工具推荐 ${MANIFEST_VERSION}。原因：卡带可能由其他版本生成。影响：部分字段可能无法识别。解决方案：建议用当前版本 AgentVN 重新导出。`, "warning", "manifest.manifest_version"));
  }
  return splitIssues(issues);
}

export function validateEntryScene(script: RuntimeScript): CartridgeValidationResult {
  if (scenesOf(script).some((scene) => scene.scene_id === script.entry_scene_id)) return splitIssues([]);
  return splitIssues([
    issue("entry_scene", `入口场景编号无效（entry_scene_id）：当前指向 ${script.entry_scene_id || "空值"}，但场景列表里找不到它。原因：入口场景被删除、改名，或 scene_id 不一致。影响：GameCLI 无法开始游戏。解决方案：请在编辑器中重新连接入口节点，或把入口场景编号改成现有场景的 scene_id。`, "error", "script.entry_scene_id")
  ]);
}

export function validateScenes(script: RuntimeScript): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  for (const scene of scenesOf(script)) {
    if (ids.has(scene.scene_id)) {
      const details = duplicateSceneDetails(script);
      issues.push(issue("duplicate_scene", `场景稳定编号重复（scene_id）：${details || scene.scene_id}。原因：场景编号是剧情跳转用的唯一身份证，不能重复。影响：系统跳转时无法确定要播放哪一个场景。解决方案：请在右侧检查器中找到重复场景，修改其中一个场景的稳定编号，例如 scene_opening_2。`, "error", `scene.${scene.scene_id}`));
    }
    ids.add(scene.scene_id);
    if (!Array.isArray(scene.commands)) {
      issues.push(issue("scene_commands", `场景事件列表格式错误（commands）：${scene.scene_id} 的 commands 不是数组。原因：卡带剧本结构损坏或被手工改坏。影响：GameCLI 无法播放该场景。解决方案：请回到编辑器重新导出，或把 commands 修正为数组。`, "error", `scene.${scene.scene_id}.commands`));
    }
  }
  return splitIssues(issues);
}

export function validateChoiceTargets(script: RuntimeScript): CartridgeValidationResult {
  const scenes = scenesOf(script);
  const sceneIds = new Set(scenes.map((scene) => scene.scene_id));
  const issues: ValidationIssue[] = [];
  for (const scene of scenes) {
    for (const command of scene.commands) {
      if (command.type === "jump") {
        if (!sceneIds.has(command.target_scene_id)) {
          issues.push(issue("jump_target", `无条件跳转目标场景编号无效（target_scene_id）：场景 ${scene.scene_id} 指向 ${command.target_scene_id || "空值"}，但该场景不存在。请把跳转目标改成现有 scene_id。`, "error", `scene.${scene.scene_id}.jump.target_scene_id`));
        }
      }
      if (command.type === "conditional_jump") {
        if (!sceneIds.has(command.target_scene_id)) {
          issues.push(issue("conditional_jump_target", `判断跳转目标场景编号无效（target_scene_id）：场景 ${scene.scene_id} 指向 ${command.target_scene_id || "空值"}，但该场景不存在。请把 true 目标改成现有 scene_id。`, "error", `scene.${scene.scene_id}.conditional_jump.target_scene_id`));
        }
        if (command.else_target_scene_id && !sceneIds.has(command.else_target_scene_id)) {
          issues.push(issue("conditional_jump_else_target", `判断跳转 else 目标场景编号无效（else_target_scene_id）：场景 ${scene.scene_id} 指向 ${command.else_target_scene_id}，但该场景不存在。请把 false 目标改成现有 scene_id，或清空 else_target_scene_id。`, "error", `scene.${scene.scene_id}.conditional_jump.else_target_scene_id`));
        }
      }
      if (command.type !== "choice") continue;
      for (const choice of command.choices) {
        if (!sceneIds.has(choice.target_scene_id)) {
          issues.push(issue("choice_target", `选项目标场景编号无效（target_scene_id）：场景 ${scene.scene_id} 的选项 ${choice.choice_id} 指向 ${choice.target_scene_id || "空值"}，但该场景不存在。原因：目标场景被删除，或 scene_id 被修改。影响：玩家点击该选项后无法进入后续剧情。解决方案：请在选项编辑器中选择一个存在的目标场景编号，或重新从选项手柄连接目标场景。`, "error", `scene.${scene.scene_id}`));
        }
      }
    }
  }
  return splitIssues(issues);
}

export function validateNextSceneTargets(script: RuntimeScript): CartridgeValidationResult {
  const scenes = scenesOf(script);
  const sceneIds = new Set(scenes.map((scene) => scene.scene_id));
  const issues: ValidationIssue[] = [];
  for (const scene of scenes) {
    if (scene.next_scene_id && !sceneIds.has(scene.next_scene_id)) {
      issues.push(issue("next_scene", `下一场景编号无效（next_scene_id）：场景 ${scene.scene_id} 指向 ${scene.next_scene_id}，但该场景不存在。原因：默认后续目标被删除，或目标 scene_id 被修改。影响：玩家播放到这里后无法继续。解决方案：请重新连接默认后续，或把 next_scene_id 改成现有场景的 scene_id。`, "error", `scene.${scene.scene_id}.next_scene_id`));
    }
  }
  return splitIssues(issues);
}

export function validateDeadEndScenes(script: RuntimeScript): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  for (const scene of scenesOf(script)) {
    const hasChoice = scene.commands.some((command) => command.type === "choice");
    const hasConditionalJump = scene.commands.some((command) => command.type === "conditional_jump" && Boolean(command.target_scene_id));
    const hasJump = scene.commands.some((command) => command.type === "jump" && Boolean(command.target_scene_id));
    if (!scene.is_ending && !scene.next_scene_id && !hasChoice && !hasConditionalJump && !hasJump) {
      issues.push(issue("dead_end_scene", `场景没有后续且不是结局（next_scene_id）：${scene.scene_id} 既没有下一场景，也没有选项分支或结局标记。原因：剧情出口未设置。影响：玩家播放到这里会停住。解决方案：请连接一个后续场景、添加选项分支，或把该节点设置为结局。`, "warning", `scene.${scene.scene_id}`));
    }
  }
  return splitIssues(issues);
}

export function validateRuntimeScript(script: RuntimeScript, manifest?: GameManifest): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  const scenes = scenesOf(script);
  if (!script.schema_version) issues.push(issue("script_schema", "剧本结构版本缺失（schema_version）：原因：script.json 没有声明结构版本。影响：GameCLI 无法判断该剧本是否可被当前版本读取。解决方案：请重新从编辑器导出卡带；如果是手工修改文件，请补回 schema_version。", "error", "script.schema_version"));
  if (!script.game_id) issues.push(issue("script_game_id", "游戏编号缺失（game_id）：原因：script.json 没有提供游戏编号。影响：存档和卡带身份无法稳定关联。解决方案：请重新导出卡带，或在 script.json 中补上与 manifest.json 一致的 game_id。", "error", "script.game_id"));
  if (!Array.isArray(script.scenes)) issues.push(issue("script_scenes", "场景列表格式错误（scenes）：原因：script.json 中 scenes 必须是数组。影响：GameCLI 无法读取剧情。解决方案：请重新导出卡带，或把 scenes 修正为数组。", "error", "script.scenes"));
  if (manifest && manifest.game_id !== script.game_id) issues.push(issue("game_id_mismatch", `游戏编号不一致（game_id）：manifest.json 为 ${manifest.game_id}，script.json 为 ${script.game_id}。原因：卡带文件之间的游戏身份不一致。影响：存档、导入和启动可能错配。解决方案：请重新导出卡带，或让两处 game_id 保持一致。`, "error", "script.game_id"));
  if (scenes.length > CARTRIDGE_LIMITS.maxSceneCount) issues.push(issue("scene_limit", `场景数量超过限制（scenes）：当前 ${scenes.length} 个，限制为 ${CARTRIDGE_LIMITS.maxSceneCount} 个。原因：卡带过大。影响：GameCLI 可能加载缓慢或失败。解决方案：请拆分工程或删减未使用场景。`, "error", "script.scenes"));
  const commandCount = scenes.reduce((total, scene) => total + (Array.isArray(scene.commands) ? scene.commands.length : 0), 0);
  if (commandCount > CARTRIDGE_LIMITS.maxCommandCount) issues.push(issue("command_limit", `事件数量超过限制（commands）：当前 ${commandCount} 条，限制为 ${CARTRIDGE_LIMITS.maxCommandCount} 条。原因：卡带事件过多。影响：GameCLI 可能加载缓慢或失败。解决方案：请拆分工程或精简场景事件。`, "error", "script.scenes"));
  const characterIds = collectCharacterIds(script);
  if (script.speaker_focus) {
    const focus = script.speaker_focus;
    if (typeof focus.enabled !== "boolean") {
      issues.push(issue("speaker_focus_enabled", "speaker_focus.enabled 必须是布尔值。", "error", "script.speaker_focus.enabled"));
    }
    if (!Number.isFinite(focus.scale) || focus.scale < MIN_SPEAKER_FOCUS_SCALE || focus.scale > MAX_SPEAKER_FOCUS_SCALE) {
      issues.push(issue("speaker_focus_scale", `speaker_focus.scale 必须在 ${MIN_SPEAKER_FOCUS_SCALE} 到 ${MAX_SPEAKER_FOCUS_SCALE} 之间。`, "error", "script.speaker_focus.scale"));
    }
    if (!Number.isFinite(focus.duration_ms) || focus.duration_ms < MIN_SPEAKER_FOCUS_DURATION_MS || focus.duration_ms > MAX_SPEAKER_FOCUS_DURATION_MS) {
      issues.push(issue("speaker_focus_duration", `speaker_focus.duration_ms 必须在 ${MIN_SPEAKER_FOCUS_DURATION_MS} 到 ${MAX_SPEAKER_FOCUS_DURATION_MS} 毫秒之间。`, "error", "script.speaker_focus.duration_ms"));
    }
  }
  for (const scene of scenes) {
    for (const command of Array.isArray(scene.commands) ? scene.commands : []) {
      if (command.type === "background") {
        for (const transitionIssue of validateVisualTransitionConfig(
          command.transition_config,
          `scene.${scene.scene_id}.background.transition_config`,
        )) {
          issues.push(issue(transitionIssue.code, transitionIssue.message, "error", transitionIssue.path));
        }
      }
      if (command.type === "sprite") {
        if (
          command.layer !== null
          && command.layer !== undefined
          && !isValidSpriteLayer(command.layer)
        ) {
          issues.push(issue(
            "sprite_layer_range",
            `Character sprite layer must be an integer between ${MIN_SPRITE_LAYER} and ${MAX_SPRITE_LAYER}.`,
            "error",
            `scene.${scene.scene_id}.sprite.${command.character_id}.layer`,
          ));
        }
        if (command.scale !== null && command.scale !== undefined && (!Number.isFinite(command.scale) || command.scale < MIN_SPRITE_SCALE || command.scale > MAX_SPRITE_SCALE)) {
          issues.push(issue("sprite_scale_range", `角色立绘缩放超出范围：${String(command.scale)}。GameCLI 支持 50% 到 200%，无效值会回退到安全范围。`, "warning", `scene.${scene.scene_id}.sprite.${command.character_id}.scale`));
        }
        for (const animationIssue of validateCharacterAnimationConfig(command.animation_config, `scene.${scene.scene_id}.sprite.${command.character_id}.animation_config`)) {
          issues.push(issue(animationIssue.code, `角色立绘动画配置无效：${animationIssue.message}`, "error", animationIssue.path));
        }
        for (const transitionIssue of validateVisualTransitionConfig(
          command.switch_transition,
          `scene.${scene.scene_id}.sprite.${command.character_id}.switch_transition`,
        )) {
          issues.push(issue(transitionIssue.code, transitionIssue.message, "error", transitionIssue.path));
        }
      }
      if (command.type === "show_image") {
        if (!command.image_id.trim()) {
          issues.push(issue("show_image_asset_missing", "展示图片事件缺少 image_id。请选择一个图片素材后再导出。", "error", `scene.${scene.scene_id}.show_image.image_id`));
        }
        if (!isValidBackgroundFit(command.image_fit)) {
          issues.push(issue("show_image_fit", `展示图片显示模式无效：${String(command.image_fit)}。支持 contain、cover、stretch。`, "error", `scene.${scene.scene_id}.show_image.image_fit`));
        }
        if (command.backdrop_opacity !== null && command.backdrop_opacity !== undefined && (!Number.isFinite(command.backdrop_opacity) || command.backdrop_opacity < 0 || command.backdrop_opacity > 0.9)) {
          issues.push(issue("show_image_backdrop_opacity", `展示图片背景暗度超出 0..0.9：${String(command.backdrop_opacity)}。`, "error", `scene.${scene.scene_id}.show_image.backdrop_opacity`));
        }
        if (command.backdrop_blur_px !== null && command.backdrop_blur_px !== undefined && (!Number.isFinite(command.backdrop_blur_px) || command.backdrop_blur_px < 0 || command.backdrop_blur_px > 24)) {
          issues.push(issue("show_image_backdrop_blur", `展示图片背景模糊超出 0..24px：${String(command.backdrop_blur_px)}。`, "error", `scene.${scene.scene_id}.show_image.backdrop_blur_px`));
        }
      }
      if (command.type === "video") {
        if (!command.video_id.trim()) {
          issues.push(issue("video_asset_missing", "过场视频事件缺少 video_id。请选择视频素材后再导出。", "error", `scene.${scene.scene_id}.video.video_id`));
        }
        if (!isValidBackgroundFit(command.video_fit)) {
          issues.push(issue("video_fit", `过场视频显示模式无效：${String(command.video_fit)}。仅支持 contain、cover、stretch。`, "error", `scene.${scene.scene_id}.video.video_fit`));
        }
        for (const [field, value] of [["fade_in_ms", command.fade_in_ms], ["fade_out_ms", command.fade_out_ms]] as const) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > MAX_VIDEO_FADE_MS)) {
            issues.push(issue("video_fade_duration", `${field} 必须在 0 到 ${MAX_VIDEO_FADE_MS} 毫秒之间。`, "error", `scene.${scene.scene_id}.video.${field}`));
          }
        }
      }
      if (command.type === "animation") {
        const targetId = spriteTargetCharacterId(command.target);
        if (targetId && targetId !== "selected" && targetId !== "all" && !characterIds.has(targetId)) {
          issues.push(issue("missing_animation_character_target", `角色动画目标无效（target）：${command.target} 找不到可追溯的角色。请先添加该角色的对白/立绘命令，或把目标改成 sprite:selected、sprite:all、已有角色 ID。`, "error", `scene.${scene.scene_id}.animation.target`));
        }
      }
      if (command.type === "camera") {
        for (const cameraIssue of validateCameraCommand(
          command,
          `scene.${scene.scene_id}.camera`,
        )) {
          issues.push(issue(cameraIssue.code, cameraIssue.message, cameraIssue.severity, cameraIssue.path));
        }
      }
    }
  }
  const sceneValidation = validateScenes(script);
  const entryValidation = validateEntryScene(script);
  const choiceValidation = validateChoiceTargets(script);
  const nextValidation = validateNextSceneTargets(script);
  const deadEndValidation = validateDeadEndScenes(script);
  return splitIssues([
    ...issues,
    ...sceneValidation.errors,
    ...entryValidation.errors,
    ...choiceValidation.errors,
    ...nextValidation.errors,
    ...deadEndValidation.warnings
  ]);
}

export function validateGallery(gallery: GalleryManifest): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  if (!gallery.gallery_version) issues.push(issue("gallery_version", "画廊版本缺失（gallery_version）：原因：gallery.json 没有声明版本。影响：GameCLI 可能无法读取画廊数据。解决方案：请重新导出卡带。", "error", "gallery.gallery_version"));
  if (!Array.isArray(gallery.items)) issues.push(issue("gallery_items", "画廊条目格式错误（items）：原因：gallery.json 中 items 必须是数组。影响：GameCLI 无法读取画廊。解决方案：请重新导出卡带，或把 items 修正为数组。", "error", "gallery.items"));
  return splitIssues(issues);
}

export function validateChecksumManifest(checksum: ChecksumManifest): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  if (checksum.algorithm !== "sha256") {
    issues.push(issue("checksum_algorithm", `校验算法不支持（algorithm）：当前为 ${checksum.algorithm ?? "缺失"}，需要 sha256。原因：checksum.json 使用了不兼容的哈希算法。影响：GameCLI 无法确认卡带文件是否完整。解决方案：请重新导出卡带。`, "error", "checksum.algorithm"));
  }
  if (!Array.isArray(checksum.files)) {
    issues.push(issue("checksum_files", "校验文件列表格式错误（checksum.files）：原因：checksum.json 中 files 必须是文件路径、大小和 sha256 哈希组成的数组。影响：GameCLI 无法校验卡带完整性。解决方案：请重新导出卡带。", "error", "checksum.files"));
  }
  return splitIssues(issues);
}

export function validateCartridgeStructure(paths: string[]): CartridgeValidationResult {
  const missing = REQUIRED_CARTRIDGE_FILES.filter((path) => !paths.includes(path));
  return splitIssues(missing.map((path) => issue("missing_required_file", `卡带缺少必要文件（${path}）：原因：.vncart 内没有找到 ${path}。影响：GameCLI 无法读取卡带。解决方案：请从编辑器重新导出 .vncart，不要手动删除卡带内部文件。`, "error", path)));
}

export function collectCommandAssetIds(command: GameCommand): string[] {
  return collectCommandAssetReferences(command).map((asset) => asset.asset_id);
}

function collectCommandAssetReferences(command: GameCommand): Array<{ asset_id: string; asset_type: AssetType; image_like?: boolean }> {
  if (command.type === "background") return command.background_id ? [{ asset_id: command.background_id, asset_type: "background" }] : [];
  if (command.type === "show_image") return command.image_id ? [{ asset_id: command.image_id, asset_type: "ui", image_like: true }] : [];
  if (command.type === "video") return command.video_id ? [{ asset_id: command.video_id, asset_type: "video" }] : [];
  if (command.type === "sprite") return command.sprite_id ? [{ asset_id: command.sprite_id, asset_type: "sprite" }] : [];
  if (command.type === "dialog") {
    const refs: Array<{ asset_id: string; asset_type: AssetType }> = [];
    if (command.portrait) refs.push({ asset_id: command.portrait, asset_type: "portrait" });
    if (command.voice) refs.push({ asset_id: command.voice, asset_type: "voice" });
    if (command.font_asset_id) refs.push({ asset_id: command.font_asset_id, asset_type: "font" });
    if (command.dialog_style?.background_asset_id) refs.push({ asset_id: command.dialog_style.background_asset_id, asset_type: "ui" });
    return refs;
  }
  if (command.type === "narration") {
    const refs: Array<{ asset_id: string; asset_type: AssetType }> = [];
    if (command.font_asset_id) refs.push({ asset_id: command.font_asset_id, asset_type: "font" });
    if (command.dialog_style?.background_asset_id) refs.push({ asset_id: command.dialog_style.background_asset_id, asset_type: "ui" });
    return refs;
  }
  if (command.type === "bgm" && command.bgm_id) return [{ asset_id: command.bgm_id, asset_type: "bgm" }];
  if (command.type === "sfx") return command.sfx_id ? [{ asset_id: command.sfx_id, asset_type: "sfx" }] : [];
  if (command.type === "animation") return [];
  return [];
}

function collectLoadingAnimationAssetReferences(script: RuntimeScript): Array<{ asset_id: string; asset_type: AssetType }> {
  const loadingAnimation = script.loading_animation;
  if (loadingAnimation?.kind === "video" && loadingAnimation.video_asset_id) {
    return [{ asset_id: loadingAnimation.video_asset_id, asset_type: "video" }];
  }
  if (loadingAnimation?.kind === "image_sequence") {
    return loadingAnimation.image_asset_ids
      .filter(Boolean)
      .map((asset_id) => ({ asset_id, asset_type: "ui" as const }));
  }
  return [];
}

function isCompatibleLoadingAnimationAsset(asset: GameManifest["assets"][number], expected: AssetType): boolean {
  if (expected === "video") return asset.asset_type === "video";
  if (expected === "ui") return isImageLikeAssetType(asset.asset_type) || asset.mime_type?.startsWith("image/") === true;
  return assetTypeMatchesExpected(asset.asset_type, expected);
}

function isValidBackgroundFit(value: unknown): boolean {
  return value === undefined || value === null || value === "stretch" || value === "contain" || value === "cover";
}

function isValidShellBackgroundDimming(value: unknown): boolean {
  return value === undefined || (Number.isFinite(value) && Number(value) >= 0 && Number(value) <= 0.9);
}

export function validateAssetReferences(script: RuntimeScript, manifest: GameManifest): CartridgeValidationResult {
  const assets = new Map(manifest.assets.map((asset) => [asset.asset_id, asset]));
  const issues: ValidationIssue[] = [];
  if (!isValidBackgroundFit(manifest.shell?.background_fit)) {
    issues.push(issue("background_fit", `Shell background display mode is invalid: ${String(manifest.shell?.background_fit)}. GameCLI supports stretch, contain, and cover; invalid values fall back to stretch.`, "warning", "manifest.shell.background_fit"));
  }
  if (!isValidShellBackgroundDimming(manifest.shell?.title_background_dimming)) {
    issues.push(issue("shell_background_dimming", `Title background dimming is invalid: ${String(manifest.shell?.title_background_dimming)}. GameCLI expects a number from 0 to 0.9; invalid values fall back to the runtime default.`, "warning", "manifest.shell.title_background_dimming"));
  }
  if (!isValidBackgroundFit(manifest.shell?.settings_panel_background_fit)) {
    issues.push(issue("background_fit", `Settings panel background display mode is invalid: ${String(manifest.shell?.settings_panel_background_fit)}. GameCLI supports stretch, contain, and cover; invalid values fall back to stretch.`, "warning", "manifest.shell.settings_panel_background_fit"));
  }
  if (!isValidShellBackgroundDimming(manifest.shell?.settings_panel_background_dimming)) {
    issues.push(issue("shell_background_dimming", `Settings panel background dimming is invalid: ${String(manifest.shell?.settings_panel_background_dimming)}. GameCLI expects a number from 0 to 0.9; invalid values fall back to the runtime default.`, "warning", "manifest.shell.settings_panel_background_dimming"));
  }
  for (const [label, assetId] of Object.entries({
    shell_background: manifest.shell?.background,
    shell_background_video: manifest.shell?.background_video,
    shell_icon: manifest.shell?.icon,
    settings_panel_background: manifest.shell?.settings_panel_background,
    settings_entry_image: manifest.shell?.settings_entry_image,
  })) {
    if (assetId && !assets.has(assetId)) {
      issues.push(issue("missing_asset", `Shell visual asset is not packed: ${assetId} (${label}). Re-select the runtime visual asset and export again.`, "error", `manifest.shell.${label}`));
    }
  }
  const shellVideo = manifest.shell?.background_video ? assets.get(manifest.shell.background_video) : undefined;
  if (shellVideo && shellVideo.asset_type !== "video") {
    issues.push(issue("asset_type_mismatch", `Title background video ${shellVideo.asset_id} must use asset_type video.`, "error", "manifest.shell.background_video"));
  }
  for (const [index, character] of (script.characters ?? []).entries()) {
    const assetId = character.dialog_style?.background_asset_id;
    if (!isValidBackgroundFit(character.dialog_style?.background_fit)) {
      issues.push(issue("dialog_background_fit", `Character dialog background display mode is invalid: ${String(character.dialog_style?.background_fit)}. GameCLI supports stretch, contain, and cover; invalid values fall back to cover.`, "warning", `script.characters.${index}.dialog_style.background_fit`));
    }
    if (assetId && !assets.has(assetId)) {
      issues.push(issue("missing_asset", `Character dialog background asset is not packed: ${assetId}. Re-select the dialog background and export again.`, "error", `script.characters.${index}.dialog_style.background_asset_id`));
    }
  }
  for (const ref of collectLoadingAnimationAssetReferences(script)) {
    const asset = assets.get(ref.asset_id);
    if (!asset) {
      issues.push(issue("missing_asset", `Loading animation asset is not packed: ${ref.asset_id}. Import the loading animation media again and export the cartridge.`, "error", "script.loading_animation"));
    } else if (!isCompatibleLoadingAnimationAsset(asset, ref.asset_type)) {
      const expectedLabel = ref.asset_type === "ui" ? "an image asset (background, sprite, portrait, or ui)" : ref.asset_type;
      issues.push(issue("asset_type_mismatch", `Loading animation asset type mismatch: ${ref.asset_id} is used as ${expectedLabel}, but manifest marks it as ${asset.asset_type}.`, "error", "script.loading_animation"));
    }
  }
  for (const scene of scenesOf(script)) {
    for (const command of scene.commands) {
      if (command.type === "background" && !isValidBackgroundFit(command.background_fit)) {
        issues.push(issue("background_fit", `Background command display mode is invalid: ${String(command.background_fit)}. GameCLI supports stretch, contain, and cover; invalid values fall back to stretch.`, "warning", `scene.${scene.scene_id}.background_fit`));
      }
      if ((command.type === "dialog" || command.type === "narration") && !isValidBackgroundFit(command.dialog_style?.background_fit)) {
        issues.push(issue("dialog_background_fit", `Dialog background display mode is invalid: ${String(command.dialog_style?.background_fit)}. GameCLI supports stretch, contain, and cover; invalid values fall back to cover.`, "warning", `scene.${scene.scene_id}.dialog_style.background_fit`));
      }
      for (const ref of collectCommandAssetReferences(command)) {
        const asset = assets.get(ref.asset_id);
        if (!asset) {
          issues.push(issue("missing_asset", `素材编号未打包（asset_id）：${ref.asset_id} 被剧情事件引用，但不在卡带素材清单中。原因：素材库里缺少该资源，或导出时没有收集到它。影响：GameCLI 播放到相关背景、立绘、头像、语音、BGM 或音效时可能显示/播放失败。解决方案：请在素材库中补充该资源，或把事件里的资源编号改成已存在的 asset_id。`, "error", `scene.${scene.scene_id}`));
        } else if (ref.image_like ? !(isImageLikeAssetType(asset.asset_type) || asset.mime_type?.startsWith("image/") === true) : !assetTypeMatchesExpected(asset.asset_type, ref.asset_type)) {
          issues.push(issue("asset_type_mismatch", `素材类型不匹配：${ref.asset_id} 被剧情事件当作${assetTypeDisplayLabel(ref.asset_type)}使用，但素材清单登记为${assetTypeDisplayLabel(asset.asset_type)}。请在素材库修改素材类型，或在事件里重新选择合适素材。`, "error", `scene.${scene.scene_id}`));
        }
      }
    }
  }
  for (const item of manifest.assets) {
    if (!item.path.startsWith("assets/") && !(item.asset_type === "ui" && item.path.startsWith("ui/assets/"))) {
      issues.push(issue("asset_path", `素材路径不在允许目录（path）：${item.asset_id} 当前路径为 ${item.path}。原因：普通素材必须放在 assets/ 下，UI 素材必须放在 ui/assets/ 或 assets/ 下。影响：GameCLI 可能拒绝加载该资源。解决方案：请重新导入素材并重新导出卡带。`, "warning", item.path));
    }
  }
  return splitIssues(issues);
}

export function validateVersionCompatibility(manifest: GameManifest, runtimeVersion: string): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRuntimeCompatible(manifest.runtime_version, runtimeVersion)) {
    issues.push(issue("runtime_version", `GameCLI 版本过低（runtime_version）：卡带要求 ${manifest.runtime_version}，当前 GameCLI 为 ${runtimeVersion}。原因：卡带使用了当前播放器不支持的功能。影响：游戏可能无法启动或表现异常。解决方案：请更新 GameCLI，或用当前版本 AgentVN 重新导出卡带。`, "error", "manifest.runtime_version"));
  }
  if (!isCartridgeFormatCompatible(manifest.cartridge_version, CARTRIDGE_FORMAT_VERSION)) {
    issues.push(issue("cartridge_version", `卡带格式版本过新（cartridge_version）：卡带为 ${manifest.cartridge_version}，当前工具支持 ${CARTRIDGE_FORMAT_VERSION}。原因：卡带可能由更高版本 AgentVN 生成。影响：当前 GameCLI 无法安全读取。解决方案：请更新 GameCLI，或用当前版本重新导出卡带。`, "error", "manifest.cartridge_version"));
  }
  return splitIssues(issues);
}

const editorFields = ["data", "nodes", "edges", "viewport", "editorMeta", "previewState", "aiSettings", "reactFlow"];
const editorPositionPaths = [
  /^\$\.nodes\.\d+\.position$/,
  /^\$\.nodes\.\d+\.positionAbsolute$/,
  /^\$\.nodes\.\d+\.measured$/,
  /^\$\.nodes\.\d+\.dragging$/,
  /^\$\.nodes\.\d+\.selected$/
];
const aiFields = ["embedding", "ChronicleGraph", "EmotionTrace", "relational_graph", "episodic_memory", "api_key", "provider", "memory_mode"];

function containsForbiddenField(value: unknown, fields: string[], path = "$"): ValidationIssue[] {
  if (!value || typeof value !== "object") return [];
  const issues: ValidationIssue[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (fields.includes(key)) {
      issues.push(issue("forbidden_field", `卡带包含不允许的编辑器或 AI 字段（${key}）：原因：卡带只能包含玩家端需要的数据。影响：可能泄露编辑器草稿、AI 设置或本地信息。解决方案：请从编辑器重新导出 .vncart，不要把 project.vnproj 或编辑器内部字段手工塞进卡带。`, "error", nextPath));
    }
    if (key === "position" && editorPositionPaths.some((pattern) => pattern.test(nextPath))) {
      issues.push(issue("forbidden_field", "卡带包含不允许的编辑器坐标字段（position）：原因：玩家端不需要画布坐标。影响：卡带可能混入创作期数据。解决方案：请重新导出 .vncart。", "error", nextPath));
    }
    issues.push(...containsForbiddenField(child, fields, nextPath));
  }
  return issues;
}

export function validateNoEditorFields(value: unknown): CartridgeValidationResult {
  return splitIssues(containsForbiddenField(value, editorFields));
}

export function validateNoAIMetadata(value: unknown): CartridgeValidationResult {
  return splitIssues(containsForbiddenField(value, aiFields));
}

function unsafePathReason(path: string): string | undefined {
  if (path.includes("\0")) return "包含空字符";
  if (path.startsWith("/") || path.startsWith("\\")) return "使用了绝对路径";
  if (/^[a-zA-Z]:/.test(path)) return "包含 Windows 盘符";
  if (path.includes("\\")) return "使用了反斜杠";
  if (path.split("/").includes("..")) return "包含上级目录片段";
  return undefined;
}

function dangerousExtension(path: string): string | undefined {
  const lowerPath = path.toLowerCase();
  return DANGEROUS_EXTENSIONS.find((ext) => lowerPath.endsWith(ext));
}

export function validateSafePaths(paths: string[]): CartridgeValidationResult {
  const issues = paths.map((path) => {
    const reason = unsafePathReason(path);
    return reason
      ? issue("unsafe_path", `卡带路径不安全（path）：${path}，原因：${reason}。影响：GameCLI 会拒绝可能越界或不安全的文件路径。解决方案：请重新导出卡带，确保卡带内部路径是相对路径并留在卡带目录内。`, "error", path)
      : undefined;
  }).filter((value): value is ValidationIssue => Boolean(value));
  return splitIssues(issues);
}

export function validateNoExecutableFiles(paths: string[]): CartridgeValidationResult {
  const issues = paths.map((path) => {
    const ext = dangerousExtension(path);
    return ext
      ? issue("executable_file", `卡带包含不允许的可执行文件（${ext}）：${path}。原因：.vncart 只能携带数据和素材，不能携带可执行程序。影响：GameCLI 会拒绝导入以保护用户环境。解决方案：请移除该文件，只打包图片、音频、视频或 JSON 数据。`, "error", path)
      : undefined;
  }).filter((value): value is ValidationIssue => Boolean(value));
  return splitIssues(issues);
}

export function validateFileSizeLimits(files: Array<{ path: string; size: number }>, maxSingleMB = CARTRIDGE_LIMITS.maxSingleFileSizeMB, maxPackageMB = CARTRIDGE_LIMITS.maxPackageSizeMB): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  const maxSingle = maxSingleMB * 1024 * 1024;
  const maxPackage = maxPackageMB * 1024 * 1024;
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (file.size > maxSingle) {
      issues.push(issue("single_file_size", `单个文件超过大小限制（size_bytes）：${file.path} 超过 ${maxSingleMB}MB。原因：该素材文件过大。影响：GameCLI 可能加载缓慢或导入失败。解决方案：请压缩该素材，或换用更小的文件。`, "error", file.path));
    }
  }
  if (total > maxPackage) {
    issues.push(issue("package_size", `卡带总体积超过限制（package size）：当前约 ${Math.round(total / 1024 / 1024)}MB，限制为 ${maxPackageMB}MB。原因：卡带素材总量过大。影响：GameCLI 可能导入失败。解决方案：请压缩素材或拆分项目。`, "error"));
  }
  return splitIssues(issues);
}
