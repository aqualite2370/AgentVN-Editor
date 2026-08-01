import type { CameraCommand } from "../types/commands";
import {
  CAMERA_DEFAULTS,
  createDefaultCameraCommand,
  isCameraPoseSafe,
  parseCameraEasing,
  type StructuredCameraCommand,
} from "../../../shared/camera/cameraMotion";

type LegacyCameraCommand = Extract<CameraCommand, { action: string }>;

function legacyDuration(
  command: LegacyCameraCommand,
  fallback: number,
  maximum: number,
): number | undefined {
  const raw = command.params.duration_ms ?? command.params.duration;
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= maximum ? value : undefined;
}

function hasOnlyLegacyParams(
  command: LegacyCameraCommand,
  allowed: readonly string[],
): boolean {
  const accepted = new Set(allowed);
  return Object.keys(command.params).every((key) => accepted.has(key));
}

function legacyIntensity(
  command: LegacyCameraCommand,
  fallback: number,
): number | undefined {
  if (command.params.intensity === undefined) return fallback;
  const value = Number(command.params.intensity);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

export function convertibleLegacyCamera(command: LegacyCameraCommand): StructuredCameraCommand | undefined {
  const action = command.action.trim().toLowerCase();
  if (action === "shake") {
    if (!hasOnlyLegacyParams(command, ["duration_ms", "duration", "intensity", "direction"])) return undefined;
    const next = createDefaultCameraCommand("shake");
    if (next.motion.kind !== "shake") return undefined;
    const duration = legacyDuration(command, next.motion.duration_ms, 3000);
    const intensity = legacyIntensity(command, next.motion.intensity);
    const direction = command.params.direction ?? next.motion.direction;
    if (
      duration === undefined
      || intensity === undefined
      || (direction !== "horizontal" && direction !== "vertical" && direction !== "omni")
    ) return undefined;
    return {
      ...next,
      blocking: command.blocking,
      motion: { ...next.motion, duration_ms: duration, intensity, direction },
    };
  }
  if (action === "impact") {
    if (!hasOnlyLegacyParams(command, ["duration_ms", "duration", "intensity", "direction"])) return undefined;
    const next = createDefaultCameraCommand("impact");
    if (next.motion.kind !== "impact") return undefined;
    const duration = legacyDuration(command, next.motion.duration_ms, 3000);
    const intensity = legacyIntensity(command, next.motion.intensity);
    const direction = command.params.direction ?? next.motion.direction;
    if (
      duration === undefined
      || intensity === undefined
      || (
        direction !== "from_left"
        && direction !== "from_right"
        && direction !== "from_top"
        && direction !== "from_bottom"
        && direction !== "omni"
      )
    ) return undefined;
    return {
      ...next,
      blocking: command.blocking,
      motion: { ...next.motion, duration_ms: duration, intensity, direction },
    };
  }
  if (!hasOnlyLegacyParams(command, ["center_x", "center_y", "zoom", "duration_ms", "duration", "easing"])) return undefined;
  const centerX = Number(command.params.center_x);
  const centerY = Number(command.params.center_y);
  const zoom = Number(command.params.zoom);
  const duration = legacyDuration(command, 1400, 10_000);
  const easing = command.params.easing === undefined
    ? CAMERA_DEFAULTS.cinematicEasing
    : parseCameraEasing(command.params.easing);
  if (
    Number.isFinite(centerX)
    && centerX >= 0
    && centerX <= 1
    && Number.isFinite(centerY)
    && centerY >= 0
    && centerY <= 1
    && Number.isFinite(zoom)
    && zoom >= 0.5
    && zoom <= 4
    && duration !== undefined
    && easing
  ) {
    const pose = { center_x: centerX, center_y: centerY, zoom };
    return {
      type: "camera",
      blocking: command.blocking,
      motion: {
        schema_version: 1,
        kind: "reframe",
        to: pose,
        duration_ms: duration,
        easing,
        ...(!isCameraPoseSafe(pose) ? { unsafe_overscan: true as const } : {}),
      },
    };
  }
  return undefined;
}
