import type { BackgroundFit } from "../../../shared/cartridge/types";
import type { BgmAction, CharacterSide, StateOperation } from "../types/commands";
import type { AssetType } from "../types/assets";
import type { ProviderModelParameters } from "../providers/types";
import { assetCategoryOptions } from "../../../shared/cartridge/assetTaxonomy";

export const transitionOptions = [
  { value: "fade", label: "淡入淡出" },
  { value: "cut", label: "瞬切" },
  { value: "dissolve", label: "溶解" },
  { value: "slide", label: "滑入" },
  { value: "slide_left", label: "向左滑入" },
  { value: "slide_right", label: "向右滑入" },
  { value: "flash", label: "闪白" },
  { value: "none", label: "无转场" },
] as const;

export const backgroundFitOptions: Array<{ value: BackgroundFit; label: string; description: string }> = [
  { value: "stretch", label: "强制铺满", description: "拉伸到容器宽高，不留边不裁切。" },
  { value: "contain", label: "完整显示", description: "保持比例完整显示，可能留边。" },
  { value: "cover", label: "裁切铺满", description: "保持比例铺满，可能裁切边缘。" },
];

export const artworkFitOptions: Array<{ value: BackgroundFit; label: string; description: string }> = [
  { value: "contain", label: "缩放完整显示", description: "保持原图比例缩放，完整显示素材，边缘可能留空。" },
  { value: "cover", label: "裁切铺满", description: "保持原图比例铺满组件，超出部分会从边缘裁切。" },
];

export const characterSideOptions: Array<{ value: CharacterSide; label: string }> = [
  { value: "left", label: "左侧" },
  { value: "center", label: "居中" },
  { value: "right", label: "右侧" },
];

export const spritePositionOptions = [
  { value: "left", label: "左侧" },
  { value: "center", label: "居中" },
  { value: "right", label: "右侧" },
  { value: "foreground", label: "前景" },
  { value: "background", label: "后景" },
] as const;

export const spriteAnimationOptions = [
  { value: "fade_in", label: "淡入" },
  { value: "fade_out", label: "淡出" },
  { value: "slide_in_left", label: "从左滑入" },
  { value: "slide_in_right", label: "从右滑入" },
  { value: "slide_out_left", label: "向左滑出" },
  { value: "slide_out_right", label: "向右滑出" },
  { value: "shake", label: "抖动" },
  { value: "heartbeat", label: "心跳缩放" },
] as const;

export const stateOperationOptions: Array<{ value: StateOperation; label: string }> = [
  { value: "set", label: "设为" },
  { value: "add", label: "增加" },
  { value: "subtract", label: "减少" },
  { value: "toggle", label: "开关切换" },
  { value: "append", label: "追加到列表" },
  { value: "remove", label: "从列表移除" },
];

export const bgmActionOptions: Array<{ value: BgmAction; label: string }> = [
  { value: "play", label: "播放" },
  { value: "stop", label: "停止" },
  { value: "fade", label: "淡入淡出" },
];

export const cameraActionOptions = [
  { value: "shake", label: "镜头震动" },
  { value: "zoom", label: "镜头推进" },
  { value: "pan", label: "镜头平移" },
  { value: "reset", label: "恢复默认镜头" },
] as const;

export const animationTargetOptions = [
  { value: "screen", label: "整个画面" },
  { value: "background", label: "背景" },
  { value: "sprite:selected", label: "当前角色图像" },
  { value: "sprite:all", label: "全部角色图像" },
  { value: "ui", label: "界面元素" },
  { value: "camera", label: "镜头" },
] as const;

export const easingOptions = [
  { value: "linear", label: "匀速" },
  { value: "ease", label: "平滑" },
  { value: "ease-in", label: "加速" },
  { value: "ease-out", label: "减速" },
  { value: "ease-in-out", label: "先加速后减速" },
  { value: "cubic-bezier(.2,.8,.2,1)", label: "自然弹性" },
] as const;

export const assetTypeOptions: Array<{ value: AssetType; label: string; description: string }> =
  assetCategoryOptions.map((option) => ({
    value: option.value as AssetType,
    label: option.label,
    description: `${option.description} ${option.example}`,
  }));

export const stylePresetOptions = [
  { value: "anime_visual_novel", label: "日系视觉小说" },
  { value: "cinematic", label: "电影感" },
  { value: "watercolor", label: "水彩插画" },
  { value: "pixel_art", label: "像素风" },
  { value: "ui_clean", label: "清爽界面素材" },
] as const;

export const structuredModeOptions: Array<{ value: NonNullable<ProviderModelParameters["structured_mode"]>; label: string }> = [
  { value: "tools", label: "工具调用" },
  { value: "auto", label: "自动兼容" },
  { value: "json_object", label: "JSON 兼容" },
];
