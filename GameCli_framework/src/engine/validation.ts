import type { GameCommand } from "../types/commands";
import type { GameManifest } from "../types/manifest";
import type { SaveData } from "../types/save";
import type { RuntimeScript } from "../types/script";

export interface ValidationIssue {
  code: string;
  message: string;
}

const manifestFieldLabels: Record<string, string> = {
  manifest_version: "卡带清单版本",
  game_id: "游戏编号",
  entry_script: "入口剧本文件"
};

function scenesOf(script: RuntimeScript): RuntimeScript["scenes"] {
  return Array.isArray(script.scenes) ? script.scenes : [];
}

export function validateRuntimeScript(script: RuntimeScript): ValidationIssue[] {
  return [
    ...validateScenes(script),
    ...validateCommandFields(script),
    ...validateEntryScene(script),
    ...validateChoiceTargets(script),
    ...validateNextSceneTargets(script)
  ];
}

export function validateCommandFields(script: RuntimeScript): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const scene of scenesOf(script)) {
    for (const [index, command] of scene.commands.entries()) {
      const path = `${scene.scene_id}.commands.${index}`;
      if (command.type === "show_image") {
        if (!command.image_id?.trim()) {
          issues.push({ code: "show_image_asset_missing", message: `${path} 的展示图片事件缺少 image_id。` });
        }
        if (command.image_fit && !["contain", "cover", "stretch"].includes(command.image_fit)) {
          issues.push({ code: "show_image_fit", message: `${path} 的 image_fit 无效，仅支持 contain、cover、stretch。` });
        }
        if (command.backdrop_opacity != null && (!Number.isFinite(command.backdrop_opacity) || command.backdrop_opacity < 0 || command.backdrop_opacity > 0.9)) {
          issues.push({ code: "show_image_backdrop_opacity", message: `${path} 的 backdrop_opacity 必须在 0 到 0.9 之间。` });
        }
        if (command.backdrop_blur_px != null && (!Number.isFinite(command.backdrop_blur_px) || command.backdrop_blur_px < 0 || command.backdrop_blur_px > 24)) {
          issues.push({ code: "show_image_backdrop_blur", message: `${path} 的 backdrop_blur_px 必须在 0 到 24 之间。` });
        }
      }
      if (command.type === "video") {
        if (!command.video_id?.trim()) {
          issues.push({ code: "video_asset_missing", message: `${path} 的过场视频事件缺少 video_id。` });
        }
        if (command.video_fit && !["contain", "cover", "stretch"].includes(command.video_fit)) {
          issues.push({ code: "video_fit", message: `${path} 的 video_fit 无效，仅支持 contain、cover、stretch。` });
        }
        if (command.fade_in_ms != null && (!Number.isFinite(command.fade_in_ms) || command.fade_in_ms < 0 || command.fade_in_ms > 10000)) {
          issues.push({ code: "video_fade_in", message: `${path} 的 fade_in_ms 必须在 0 到 10000 之间。` });
        }
        if (command.fade_out_ms != null && (!Number.isFinite(command.fade_out_ms) || command.fade_out_ms < 0 || command.fade_out_ms > 10000)) {
          issues.push({ code: "video_fade_out", message: `${path} 的 fade_out_ms 必须在 0 到 10000 之间。` });
        }
      }
    }
  }
  return issues;
}

export function validateManifest(manifest: GameManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of ["manifest_version", "game_id", "entry_script"] as const) {
    if (!manifest[field]) {
      issues.push({
        code: field,
        message: `${manifestFieldLabels[field]}缺失（${field}）：原因：manifest.json 没有提供这个必要字段。影响：GameCLI 无法确认卡带身份、入口或兼容性。解决方案：请回到 AgentVN 编辑器重新导出卡带。`
      });
    }
  }
  return issues;
}

export function validateScenes(script: RuntimeScript): ValidationIssue[] {
  const counts = new Map<string, number>();
  const issues: ValidationIssue[] = [];
  const scenes = scenesOf(script);
  for (const scene of scenes) counts.set(scene.scene_id, (counts.get(scene.scene_id) ?? 0) + 1);
  for (const scene of scenes) {
    if ((counts.get(scene.scene_id) ?? 0) > 1) {
      issues.push({
        code: "duplicate_scene",
        message: `场景稳定编号重复（scene_id）：${scene.scene_id}。原因：场景编号是剧情跳转用的唯一身份证，不能重复。影响：系统跳转时无法确定要播放哪一个场景。解决方案：请在编辑器右侧检查器中找到重复场景，修改其中一个场景的稳定编号，例如 scene_opening_2。`
      });
    }
    if (!Array.isArray(scene.commands)) {
      issues.push({
        code: "commands",
        message: `场景事件列表格式错误（commands）：${scene.scene_id} 的 commands 不是数组。原因：卡带剧本结构损坏或被手工改坏。影响：GameCLI 无法播放该场景。解决方案：请回到编辑器重新导出，或把 commands 修正为数组。`
      });
    }
  }
  return issues;
}

export function validateEntryScene(script: RuntimeScript): ValidationIssue[] {
  const scenes = scenesOf(script);
  return scenes.some((scene) => scene.scene_id === script.entry_scene_id)
    ? []
    : [{
        code: "entry_scene",
        message: `入口场景编号无效（entry_scene_id）：当前指向 ${script.entry_scene_id || "空值"}，但场景列表里找不到它。原因：入口场景被删除、改名，或 scene_id 不一致。影响：GameCLI 无法开始游戏。解决方案：请在编辑器中重新连接入口节点，或把入口场景编号改成现有场景的 scene_id。`
      }];
}

export function validateChoiceTargets(script: RuntimeScript): ValidationIssue[] {
  const scenes = scenesOf(script);
  const sceneIds = new Set(scenes.map((scene) => scene.scene_id));
  const issues: ValidationIssue[] = [];
  for (const scene of scenes) {
    for (const command of scene.commands) {
      if (command.type === "jump") {
        if (!sceneIds.has(command.target_scene_id)) {
          issues.push({ code: "jump_target", message: `跳转目标场景编号无效：场景 ${scene.scene_id} 指向 ${command.target_scene_id || "空值"}，但该场景不存在。` });
        }
      }
      if (command.type === "conditional_jump") {
        if (!sceneIds.has(command.target_scene_id)) {
          issues.push({
            code: "conditional_jump_target",
            message: `判断跳转目标场景编号无效（target_scene_id）：场景 ${scene.scene_id} 指向 ${command.target_scene_id || "空值"}，但该场景不存在。请把 true 目标改成现有 scene_id。`
          });
        }
        if (command.else_target_scene_id && !sceneIds.has(command.else_target_scene_id)) {
          issues.push({
            code: "conditional_jump_else_target",
            message: `判断跳转 else 目标场景编号无效（else_target_scene_id）：场景 ${scene.scene_id} 指向 ${command.else_target_scene_id}，但该场景不存在。请把 false 目标改成现有 scene_id，或清空 else_target_scene_id。`
          });
        }
      }
      if (command.type !== "choice") continue;
      for (const choice of command.choices) {
        if (!sceneIds.has(choice.target_scene_id)) {
          issues.push({
            code: "choice_target",
            message: `选项目标场景编号无效（target_scene_id）：场景 ${scene.scene_id} 的选项 ${choice.choice_id} 指向 ${choice.target_scene_id || "空值"}，但该场景不存在。原因：目标场景被删除，或 scene_id 被修改。影响：玩家点击该选项后无法进入后续剧情。解决方案：请在选项编辑器中选择一个存在的目标场景编号，或重新从选项手柄连接目标场景。`
          });
        }
      }
    }
  }
  return issues;
}

export function validateNextSceneTargets(script: RuntimeScript): ValidationIssue[] {
  const scenes = scenesOf(script);
  const sceneIds = new Set(scenes.map((scene) => scene.scene_id));
  const issues: ValidationIssue[] = [];
  for (const scene of scenes) {
    if (scene.next_scene_id && !sceneIds.has(scene.next_scene_id)) {
      issues.push({
        code: "next_scene",
        message: `下一场景编号无效（next_scene_id）：场景 ${scene.scene_id} 指向 ${scene.next_scene_id}，但该场景不存在。原因：默认后续目标被删除，或目标 scene_id 被修改。影响：玩家播放到这里后无法继续。解决方案：请重新连接默认后续，或把 next_scene_id 改成现有场景的 scene_id。`
      });
    }
  }
  return issues;
}

export function validateAssetReferences(script: RuntimeScript, manifest: GameManifest): ValidationIssue[] {
  const assets = new Map(manifest.assets.map((asset) => [asset.asset_id, asset]));
  const issues: ValidationIssue[] = [];
  const check = (id: string | null | undefined, code: string, label: string) => {
    if (id && !assets.has(id)) {
      issues.push({
        code,
        message: `${label}资源编号未打包（asset_id）：${id} 被剧情事件引用，但不在卡带素材清单中。原因：素材库里缺少该资源，或导出时没有收集到它。影响：GameCLI 播放到相关事件时可能显示或播放失败。解决方案：请在素材库中补充该资源，或把事件里的资源编号改成已存在的 asset_id。`
      });
    }
  };
  const loadingAnimation = script.loading_animation;
  if (loadingAnimation?.kind === "video") check(loadingAnimation.video_asset_id, "loading_animation_asset", "载入动画视频");
  if (loadingAnimation?.kind === "image_sequence") {
    for (const assetId of loadingAnimation.image_asset_ids) check(assetId, "loading_animation_asset", "载入动画图片");
  }
  check(manifest.shell?.background, "shell_background_asset", "首页开屏图");
  check(manifest.shell?.background_video, "shell_background_video_asset", "首页背景视频");
  const shellVideo = manifest.shell?.background_video ? assets.get(manifest.shell.background_video) : undefined;
  if (shellVideo && shellVideo.asset_type !== "video") {
    issues.push({ code: "shell_background_video_type", message: `首页背景视频 ${shellVideo.asset_id} 不是 video 类型素材。` });
  }
  check(manifest.shell?.icon, "shell_icon_asset", "卡带图标");
  check(manifest.shell?.settings_panel_background, "settings_panel_background_asset", "设置区图片");
  check(manifest.shell?.settings_entry_image, "settings_entry_image_asset", "设置入口图片");
  for (const character of script.characters ?? []) {
    check(character.dialog_style?.background_asset_id, "dialog_background_asset", "角色对白框底图");
  }
  for (const scene of scenesOf(script)) {
    for (const command of scene.commands as GameCommand[]) {
      if (command.type === "background") check(command.background_id, "background_asset", "背景");
      if (command.type === "show_image") {
        check(command.image_id, "show_image_asset", "展示图片");
        const asset = assets.get(command.image_id);
        const imageLike = asset && (
          ["background", "sprite", "portrait", "ui"].includes(asset.asset_type) ||
          asset.mime_type?.startsWith("image/") === true
        );
        if (asset && !imageLike) {
          issues.push({
            code: "show_image_asset_type",
            message: `展示图片事件引用的素材 ${command.image_id} 不是图片类素材。`,
          });
        }
      }
      if (command.type === "video") {
        check(command.video_id, "video_asset", "过场视频");
        const asset = assets.get(command.video_id);
        if (asset && asset.asset_type !== "video") {
          issues.push({
            code: "video_asset_type",
            message: `过场视频事件引用的素材 ${command.video_id} 不是视频类型素材。`,
          });
        }
      }
      if (command.type === "sprite") check(command.sprite_id, "sprite_asset", "立绘");
      if (command.type === "dialog") {
        check(command.portrait, "portrait_asset", "头像");
        check(command.voice, "voice_asset", "语音");
        check(command.font_asset_id, "font_asset", "字体");
        check(command.dialog_style?.background_asset_id, "dialog_background_asset", "对白框底图");
      }
      if (command.type === "narration") {
        check(command.font_asset_id, "font_asset", "字体");
        check(command.dialog_style?.background_asset_id, "dialog_background_asset", "旁白框底图");
      }
      if (command.type === "bgm") check(command.bgm_id, "bgm_asset", "BGM");
      if (command.type === "sfx") check(command.sfx_id, "sfx_asset", "音效");
    }
  }
  return issues;
}

export function validateSaveData(save: SaveData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (save.save_kind && save.save_kind !== "manual" && save.save_kind !== "auto") {
    issues.push({ code: "save_kind", message: "存档分类无效（save_kind）：只支持 manual 或 auto。请删除损坏存档后重新保存。" });
  }
  if (save.preview_image && !save.preview_image.startsWith("data:image/webp;base64,")) {
    issues.push({ code: "preview_image", message: "存档预览格式无效（preview_image）：只支持内嵌 WebP 快照。存档仍可尝试读取，但不会显示预览图。" });
  }
  if (!save.save_id) issues.push({ code: "save_id", message: "存档编号缺失（save_id）：原因：存档文件没有唯一编号。影响：GameCLI 无法稳定识别这个存档槽。解决方案：请重新保存游戏，或删除损坏存档后再试。" });
  if (!save.game_id) issues.push({ code: "game_id", message: "游戏编号缺失（game_id）：原因：存档没有记录所属游戏。影响：GameCLI 无法判断该存档属于哪张卡带。解决方案：请确认存档来自当前卡带，必要时重新保存。" });
  if (!save.scene_id) issues.push({ code: "scene_id", message: "当前场景编号缺失（scene_id）：原因：存档没有记录玩家所在场景。影响：读取存档时无法恢复剧情位置。解决方案：请使用其他存档，或重新开始后保存。" });
  return issues;
}
