import type { OpeningPresentation } from "./types";

/** Old projects retain the separate, full-screen, contain presentation. */
export function openingPresentationErrors(value: unknown): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["片头容器设置必须是对象。"];
  const config = value as Record<string, unknown>;
  const errors: string[] = [];
  if (config.mode !== undefined && config.mode !== "fullscreen" && config.mode !== "centered")
    errors.push("片头容器请选择全屏或居中。");
  if (config.fit !== undefined && !["contain", "cover", "stretch"].includes(String(config.fit)))
    errors.push("片头适配请选择完整显示、裁切铺满或拉伸。");
  for (const key of ["width_percent", "height_percent"] as const) {
    const size = config[key];
    if (size !== undefined && (typeof size !== "number" || !Number.isFinite(size) || size < 20 || size > 100))
      errors.push(`片头容器${key === "width_percent" ? "宽度" : "高度"}须为20–100%。`);
  }
  for (const key of Object.keys(config)) {
    if (!["mode", "fit", "width_percent", "height_percent"].includes(key)) errors.push(`不支持的片头容器参数：${key}`);
  }
  return errors;
}

export function resolveOpeningPresentation(value?: OpeningPresentation): Required<OpeningPresentation> {
  // Invalid imported data is rejected by validation/export. Guard rendering too.
  const valid = openingPresentationErrors(value).length === 0 ? value : undefined;
  return {
    mode: valid?.mode ?? "fullscreen",
    fit: valid?.fit ?? "contain",
    width_percent: valid?.width_percent ?? 80,
    height_percent: valid?.height_percent ?? 80,
  };
}

export function usesCustomOpeningPresentation(value?: OpeningPresentation): boolean {
  const resolved = resolveOpeningPresentation(value);
  return resolved.mode !== "fullscreen" || resolved.fit !== "contain";
}

export function openingPresentationStyle(value?: OpeningPresentation): {
  width: string;
  height: string;
  fit: "contain" | "cover" | "fill";
} {
  const resolved = resolveOpeningPresentation(value);
  const centered = resolved.mode === "centered";
  return {
    width: centered ? `${resolved.width_percent}%` : "100%",
    height: centered ? `${resolved.height_percent}%` : "100%",
    fit: resolved.fit === "stretch" ? "fill" : resolved.fit,
  };
}
