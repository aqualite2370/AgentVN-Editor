import type { AssetRef, AssetType } from "../types/assets";

export interface AssetSlotGuidance {
  recommended: string;
  ratio?: number;
  requiresTransparency?: boolean;
  fit: "cover" | "contain" | "bottom-contain";
}

export function resolveAssetSlotGuidance(field: string, allowedTypes: AssetType[]): AssetSlotGuidance | undefined {
  const key = field.toLowerCase();
  if (key.includes("cover")) return { recommended: "1200×1600（3:4）", ratio: 3 / 4, fit: "cover" };
  if (key.includes("icon")) return { recommended: "1024×1024（1:1）", ratio: 1, fit: "contain" };
  if (key.includes("choice") || key.includes("option")) return { recommended: "1600×240（约 20:3）", ratio: 20 / 3, fit: "contain" };
  if (allowedTypes.includes("sprite")) return { recommended: "1200×1800，透明 PNG/WebP", ratio: 2 / 3, requiresTransparency: true, fit: "bottom-contain" };
  if (allowedTypes.includes("portrait")) return { recommended: "512×512（1:1）", ratio: 1, fit: "contain" };
  if (allowedTypes.includes("background") || key.includes("background")) return { recommended: "1920×1080（16:9）", ratio: 16 / 9, fit: "cover" };
  if (allowedTypes.includes("ui")) return { recommended: "按组件目标尺寸的 2 倍，保持原比例", fit: "contain" };
  return undefined;
}

export function assetSlotWarning(asset: AssetRef | undefined, guidance: AssetSlotGuidance | undefined): string | undefined {
  if (!asset || !guidance) return undefined;
  const width = asset.metadata.width;
  const height = asset.metadata.height;
  if (guidance.requiresTransparency && asset.metadata.mime_type && !/png|webp/i.test(asset.metadata.mime_type)) return "当前素材可能没有透明通道，立绘会带出矩形背景。";
  if (!width || !height || !guidance.ratio) return undefined;
  if (Math.abs(Math.log((width / height) / guidance.ratio)) > 0.18) return `当前为 ${width}×${height}，比例与推荐值差异较大，运行时将保持比例适配。`;
  return undefined;
}
