import type { CSSProperties } from "react";
import type { BackgroundFit } from "../types/manifest";

export type ShellBackgroundDimmingTarget = "title" | "settings";

const SHELL_BACKGROUND_DIMMING_DEFAULTS: Record<ShellBackgroundDimmingTarget, number> = {
  title: 0.18,
  settings: 0.24,
};

export function clampShellBackgroundDimming(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(0.9, parsed));
}

export function resolveShellBackgroundDimming(
  runtimeOverride: number | null | undefined,
  projectDefault: number | null | undefined,
  target: ShellBackgroundDimmingTarget,
): number {
  if (runtimeOverride !== null && runtimeOverride !== undefined) {
    return clampShellBackgroundDimming(runtimeOverride, SHELL_BACKGROUND_DIMMING_DEFAULTS[target]);
  }
  if (projectDefault !== null && projectDefault !== undefined) {
    return clampShellBackgroundDimming(projectDefault, SHELL_BACKGROUND_DIMMING_DEFAULTS[target]);
  }
  return SHELL_BACKGROUND_DIMMING_DEFAULTS[target];
}

export function normalizeBackgroundFit(value: unknown): BackgroundFit {
  return value === "contain" || value === "cover" || value === "stretch" ? value : "stretch";
}

export function backgroundFitSize(value: unknown): CSSProperties["backgroundSize"] {
  const fit = normalizeBackgroundFit(value);
  return fit === "stretch" ? "100% 100%" : fit;
}

export function backgroundFitStyle(value: unknown): CSSProperties {
  return {
    backgroundSize: backgroundFitSize(value),
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  };
}

export function layeredBackgroundFitStyle(value: unknown): CSSProperties {
  return {
    backgroundSize: `100% 100%, ${backgroundFitSize(value)}`,
    backgroundRepeat: "no-repeat, no-repeat",
    backgroundPosition: "center, center",
  };
}

export function shellBackgroundStyle(url: string | undefined, value: unknown, dimming = SHELL_BACKGROUND_DIMMING_DEFAULTS.title): CSSProperties | undefined {
  if (!url) return undefined;
  const size = backgroundFitSize(value);
  const clampedDimming = clampShellBackgroundDimming(dimming, SHELL_BACKGROUND_DIMMING_DEFAULTS.title);
  const dimmingMid = Math.max(0, Math.min(0.9, Number((clampedDimming * 0.66).toFixed(3))));
  const dimmingStrong = Math.max(0, Math.min(0.9, Number((Math.min(0.9, clampedDimming * 1.14)).toFixed(3))));
  return {
    "--cartridge-shell-background": `url("${url}")`,
    "--cartridge-shell-background-image-size": size,
    "--cartridge-shell-background-size": `100% 100%, ${size}`,
    "--cartridge-shell-background-repeat": "no-repeat, no-repeat",
    "--cartridge-shell-background-position": "center, center",
    "--runtime-shell-background-dimming-base": String(clampedDimming),
    "--runtime-shell-background-dimming-mid": String(dimmingMid),
    "--runtime-shell-background-dimming-strong": String(dimmingStrong),
  } as CSSProperties;
}
