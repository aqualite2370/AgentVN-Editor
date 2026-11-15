export type GalleryImageFit = "contain" | "cover" | "fullscreen";

/** Reference resolution determines aspect, never the physical viewport size.
 * One active layout owns this shared frame for every gallery image. */
export interface GalleryPresentation {
  width: number;
  height: number;
}
export const DEFAULT_GALLERY_PRESENTATION: GalleryPresentation = { width: 1600, height: 900 };
export function galleryPresentationErrors(value: unknown): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [""];
  const record = value as Record<string, unknown>;
  return [...new Set([...Object.keys(record), "width", "height"])].filter(key =>
    !["width", "height"].includes(key) || typeof record[key] !== "number"
    || !Number.isInteger(record[key]) || (record[key] as number) < 64 || (record[key] as number) > 8192);
}
export function isGalleryImageFit(value: unknown): value is GalleryImageFit {
  return value === "contain" || value === "cover" || value === "fullscreen";
}
