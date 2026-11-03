import type { UISkinLayout } from "./uiSkin";

/** Reference pixels, scaled with Runtime UI. Origin is the existing
 * nameplate-left placement; absent fields keep the legacy automatic geometry. */
export interface DialogPortraitLayout {
  offsetX?: number;
  offsetY?: number;
  size?: number;
}

export const DIALOG_PORTRAIT_FIELDS = {
  offsetX: { min: -1280, max: 1280 },
  offsetY: { min: -720, max: 720 },
  size: { min: 12, max: 256 },
} as const;

export function dialogPortraitLayoutErrors(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [""];
  return Object.entries(value).filter(([key, field]) => {
    const bounds = Object.prototype.hasOwnProperty.call(DIALOG_PORTRAIT_FIELDS, key)
      ? DIALOG_PORTRAIT_FIELDS[key as keyof DialogPortraitLayout] : undefined;
    return !bounds || typeof field !== "number" || !Number.isFinite(field)
      || field < bounds.min || field > bounds.max;
  }).map(([key]) => key);
}

/** A single undoable edit. Never writes defaults or changes another profile. */
export function updateDialogPortraitLayout(
  layout: UISkinLayout, config: DialogPortraitLayout | undefined,
): UISkinLayout {
  if (config && dialogPortraitLayoutErrors(config).length)
    throw new Error("头像布局参数无效，原布局未被修改。");
  const next = structuredClone(layout);
  if (config && Object.keys(config).length) next.dialogPortrait = { ...config };
  else delete next.dialogPortrait;
  return next;
}
