import type { AssetType } from "./types";

export type AssetSemanticCategory =
  | "background"
  | "character_image"
  | "audio"
  | "voice"
  | "video"
  | "font"
  | "ui"
  | "other";

export interface AssetCategoryOption {
  value: AssetType;
  label: string;
  description: string;
  example: string;
  category: AssetSemanticCategory;
}

export const assetCategoryOptions: AssetCategoryOption[] = [
  {
    value: "background",
    label: "背景图",
    description: "用于场景背景、标题页背景和环境展示。",
    example: "例如 school_gate_day.png，用在“校门口白天”场景。",
    category: "background",
  },
  {
    value: "sprite",
    label: "角色图像",
    description: "用于舞台立绘和对白头像，导入后可在角色相关选择器里复用。",
    example: "例如 alice_school_uniform.png，用在角色登场和对白头像。",
    category: "character_image",
  },
  {
    value: "bgm",
    label: "音乐/音效",
    description: "用于背景音乐、环境声和短音效。",
    example: "例如 rain_loop.ogg 用作雨声，door_knock.wav 用作敲门声。",
    category: "audio",
  },
  {
    value: "voice",
    label: "语音",
    description: "用于对白配音，随角色台词播放。",
    example: "例如 alice_line_001.wav，用在爱丽丝第一句对白。",
    category: "voice",
  },
  {
    value: "video",
    label: "视频",
    description: "用于片头、过场视频或载入动画视频。",
    example: "例如 opening.mp4，用在开场演出。",
    category: "video",
  },
  {
    value: "font",
    label: "字体",
    description: "用于全局界面文字、默认对白文字或单句特殊文本。",
    example: "例如 title_handwriting.woff2，用在标题和旁白。",
    category: "font",
  },
  {
    value: "ui",
    label: "界面素材",
    description: "用于按钮、图标、对话框底图、标题页装饰和载入图片帧。",
    example: "例如 dialog_panel.png，用作对白框底图。",
    category: "ui",
  },
  {
    value: "other",
    label: "其他素材",
    description: "暂时不参与专用选择器的素材，可稍后改成具体类型。",
    example: "例如 reference_sheet.png，用作制作参考。",
    category: "other",
  },
];

export const legacyAssetTypeLabels: Record<AssetType, string> = {
  background: "背景图",
  sprite: "角色图像",
  portrait: "角色图像",
  bgm: "音乐/音效",
  sfx: "音乐/音效",
  voice: "语音",
  video: "视频",
  animation: "其他素材",
  ui: "界面素材",
  font: "字体",
  other: "其他素材",
};

export function semanticCategoryForAssetType(assetType: AssetType | string | undefined): AssetSemanticCategory {
  if (assetType === "background") return "background";
  if (assetType === "sprite" || assetType === "portrait") return "character_image";
  if (assetType === "bgm" || assetType === "sfx") return "audio";
  if (assetType === "voice") return "voice";
  if (assetType === "video") return "video";
  if (assetType === "font") return "font";
  if (assetType === "ui") return "ui";
  return "other";
}

export function assetTypeDisplayLabel(assetType: AssetType | string | undefined): string {
  return legacyAssetTypeLabels[assetType as AssetType] ?? "其他素材";
}

export function assetTypeMatchesExpected(actual: AssetType | string | undefined, expected: AssetType | string | undefined): boolean {
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  return semanticCategoryForAssetType(actual) === semanticCategoryForAssetType(expected);
}

export function isImageLikeAssetType(assetType: AssetType | string | undefined): boolean {
  return assetType === "background" || assetType === "sprite" || assetType === "portrait" || assetType === "ui";
}

export function primaryAssetTypeForCategory(category: AssetSemanticCategory): AssetType {
  if (category === "character_image") return "sprite";
  if (category === "audio") return "bgm";
  if (category === "other") return "other";
  return category;
}

export function assetCategoryHint(assetType: AssetType | string | undefined): string {
  const category = semanticCategoryForAssetType(assetType);
  const option = assetCategoryOptions.find((item) => item.category === category);
  return option ? `${option.description} ${option.example}` : "用于项目里的可复用素材。";
}
