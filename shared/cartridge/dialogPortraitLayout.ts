import type { UISkinLayout } from "./uiSkin";

/** Reference pixels, scaled with Runtime UI. Origin is the existing
 * nameplate-left placement; absent fields keep the legacy automatic geometry. */
export interface DialogPortraitLayout {
  offsetX?: number;
  offsetY?: number;
  size?: number;
  width?: number;
  height?: number;
  placement?: "stage-left" | "nameplate";
  entrance?: "slide-left" | "none";
  fit?: "contain" | "cover";
}

/** New width/height fields identify the independent portrait even if an early
 * authoring version omitted placement. Only legacy size/offset-only records
 * inherit the old name-container anchor; explicit placement always wins. */
export function dialogPortraitStagePlacement(config?: DialogPortraitLayout): boolean {
  if (config?.placement) return config.placement === "stage-left";
  if (config?.width !== undefined || config?.height !== undefined) return true;
  return config?.size === undefined && config?.offsetX === undefined && config?.offsetY === undefined;
}

export const DIALOG_PORTRAIT_FIELDS = {
  offsetX: { min: -1280, max: 1280 },
  offsetY: { min: -720, max: 720 },
  size: { min: 12, max: 256 },
  width: { min: 32, max: 640 },
  height: { min: 32, max: 640 },
} as const;

export function dialogPortraitLayoutErrors(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [""];
  return Object.entries(value).filter(([key, field]) => {
    if (key === "placement") return !["stage-left", "nameplate"].includes(String(field));
    if (key === "entrance") return !["slide-left", "none"].includes(String(field));
    if (key === "fit") return !["contain", "cover"].includes(String(field));
    const bounds = Object.prototype.hasOwnProperty.call(DIALOG_PORTRAIT_FIELDS, key)
      ? DIALOG_PORTRAIT_FIELDS[key as keyof typeof DIALOG_PORTRAIT_FIELDS] : undefined;
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
