import { nanoid } from "nanoid";
import type { ImageOperation, ImageProviderFeatureSet } from "../providers/types";
import type {
  AssetStudioAssetType,
  AssetStudioPreferences,
  AssetStudioValidationIssue,
  ImageGenerationRecipeV1,
} from "./types";

export const assetStudioAspectRatios = [
  { value: "16:9", label: "宽银幕", width: 1024, height: 576 },
  { value: "4:3", label: "经典", width: 1024, height: 768 },
  { value: "3:4", label: "立绘", width: 768, height: 1024 },
  { value: "1:1", label: "方形", width: 1024, height: 1024 },
  { value: "9:16", label: "竖屏", width: 576, height: 1024 },
] as const;

export const assetStudioOperationLabels: Record<ImageOperation, string> = {
  text_to_image: "文生图",
  image_to_image: "参考生成",
  inpaint: "局部重绘",
  outpaint: "扩图",
  variation: "制作变体",
  upscale: "智能放大",
};

export const assetStudioAssetTypePresets: Record<
  AssetStudioAssetType,
  { label: string; aspectRatio: string; width: number; height: number; promptHint: string }
> = {
  background: {
    label: "背景",
    aspectRatio: "16:9",
    width: 1024,
    height: 576,
    promptHint: "环境完整、层次清晰、适合作为视觉小说背景，不出现文字与边框",
  },
  sprite: {
    label: "立绘",
    aspectRatio: "3:4",
    width: 768,
    height: 1024,
    promptHint: "单人全身立绘、正面构图、边缘干净、背景简洁、保留脚部空间",
  },
  portrait: {
    label: "头像",
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    promptHint: "角色胸像、面部清晰、稳定光线、适合对话头像",
  },
  cg: {
    label: "剧情 CG",
    aspectRatio: "16:9",
    width: 1024,
    height: 576,
    promptHint: "电影化构图、明确叙事焦点、角色与环境关系清晰",
  },
  ui: {
    label: "UI 素材",
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    promptHint: "界面装饰素材、轮廓清晰、无文字、方便裁切与透明处理",
  },
};

export const defaultAssetStudioPreferences: AssetStudioPreferences = {
  version: 1,
  advancedOpen: false,
  railTab: "queue",
  leftWidth: 360,
  rightWidth: 344,
  rightOpen: false,
  mobilePane: "stage",
};

export function createAssetStudioRecipe(
  projectId: string,
  patch: Partial<ImageGenerationRecipeV1> = {},
): ImageGenerationRecipeV1 {
  const now = new Date().toISOString();
  const preset = assetStudioAssetTypePresets.background;
  return {
    version: 1,
    recipeId: `recipe_${projectId}_${nanoid(8)}`,
    createdAt: now,
    updatedAt: now,
    operation: "text_to_image",
    assetType: "background",
    prompt: "雨夜旧车站，视觉小说背景，湿润站台反射暖色灯光",
    negativePrompt: "",
    stylePreset: "anime_visual_novel",
    projectContext: "",
    aspectRatio: preset.aspectRatio,
    width: preset.width,
    height: preset.height,
    count: 2,
    safetyLevel: "standard",
    strength: 0.65,
    upscaleFactor: 2,
    outpaintInsets: { top: 0, right: 256, bottom: 0, left: 256 },
    references: [],
    ...patch,
  };
}

export function applyAssetTypePreset(
  recipe: ImageGenerationRecipeV1,
  assetType: AssetStudioAssetType,
): ImageGenerationRecipeV1 {
  const preset = assetStudioAssetTypePresets[assetType];
  return {
    ...recipe,
    assetType,
    aspectRatio: preset.aspectRatio,
    width: preset.width,
    height: preset.height,
    updatedAt: new Date().toISOString(),
  };
}

export function applyAspectRatio(
  recipe: ImageGenerationRecipeV1,
  aspectRatio: string,
): ImageGenerationRecipeV1 {
  const preset = assetStudioAspectRatios.find((item) => item.value === aspectRatio);
  return {
    ...recipe,
    aspectRatio,
    width: preset?.width ?? recipe.width,
    height: preset?.height ?? recipe.height,
    updatedAt: new Date().toISOString(),
  };
}

export function validateAssetStudioRecipe(
  recipe: ImageGenerationRecipeV1,
  features?: ImageProviderFeatureSet,
): AssetStudioValidationIssue[] {
  const issues: AssetStudioValidationIssue[] = [];
  if (!recipe.prompt.trim() && recipe.operation !== "upscale" && recipe.operation !== "variation") {
    issues.push({ code: "missing_prompt", path: "prompt", message: "请填写生成提示词。", severity: "error" });
  }
  if (!recipe.provider) {
    issues.push({ code: "missing_provider", path: "provider", message: "请选择可用的图像生成模型。", severity: "error" });
    return issues;
  }
  if (!features) return issues;
  if (!features.operations.includes(recipe.operation)) {
    issues.push({
      code: "unsupported_operation",
      path: "operation",
      message: `当前模型不支持“${assetStudioOperationLabels[recipe.operation]}”。`,
      severity: "error",
    });
  }
  if (recipe.negativePrompt.trim() && !features.supports_negative_prompt) {
    issues.push({
      code: "unsupported_negative_prompt",
      path: "negativePrompt",
      message: "当前模型不会接收反向提示词；请清空该字段或切换模型。",
      severity: "error",
    });
  }
  if (recipe.seed !== undefined && !features.supports_seed) {
    issues.push({
      code: "unsupported_seed",
      path: "seed",
      message: "当前模型不支持固定种子；请切换为随机种子或更换模型。",
      severity: "error",
    });
  }
  const needsSource = ["image_to_image", "inpaint", "outpaint", "variation", "upscale"].includes(recipe.operation);
  if (needsSource && !recipe.sourceImage) {
    issues.push({ code: "missing_source", path: "sourceImage", message: "当前操作需要一张来源图片。", severity: "error" });
  }
  if (recipe.operation === "inpaint" && !recipe.maskImage) {
    issues.push({ code: "missing_mask", path: "maskImage", message: "局部重绘需要先绘制蒙版。", severity: "error" });
  }
  if (recipe.references.length > 0 && features.supports_reference_roles.length === 0) {
    issues.push({
      code: "unsupported_references",
      path: "references",
      message: "当前模型不支持参考图输入，请移除参考图或切换模型。",
      severity: "error",
    });
  } else {
    const unsupportedReference = recipe.references.find(
      (reference) => !reference.role || !features.supports_reference_roles.includes(reference.role)
    );
    if (unsupportedReference) {
      issues.push({
        code: "unsupported_reference_role",
        path: "references",
        message: `当前模型不支持参考图用途“${unsupportedReference.role ?? "未指定"}”，请调整用途或移除该图片。`,
        severity: "error",
      });
    }
  }
  if (recipe.count < 1 || recipe.count > 8) {
    issues.push({ code: "invalid_count", path: "count", message: "生成数量必须在 1 到 8 之间。", severity: "error" });
  }
  if (recipe.width < 64 || recipe.height < 64 || recipe.width > 4096 || recipe.height > 4096) {
    issues.push({
      code: "invalid_dimensions",
      path: "dimensions",
      message: "宽高必须在 64 到 4096 像素之间。",
      severity: "error",
    });
  }
  return issues;
}
