import type { VisualTransitionEasing } from "../animation/visualTransition";

export type CameraJsonValue =
  | string
  | number
  | boolean
  | null
  | CameraJsonValue[]
  | { [key: string]: CameraJsonValue };

export interface CameraPoseV1 {
  center_x: number;
  center_y: number;
  zoom: number;
}

export type CameraShakeDirection = "horizontal" | "vertical" | "omni";
export type CameraImpactDirection = "from_left" | "from_right" | "from_top" | "from_bottom" | "omni";
export type CameraMotionKind = "reframe" | "sequence" | "reset" | "shake" | "impact";
export type CameraLane = "pose" | "impulse";

export interface CameraSequenceShotV1 {
  to: CameraPoseV1;
  duration_ms: number;
  easing: VisualTransitionEasing;
}

export type CameraMotionV1 =
  | {
      schema_version: 1;
      kind: "reframe";
      to: CameraPoseV1;
      duration_ms: number;
      easing: VisualTransitionEasing;
      unsafe_overscan?: true;
    }
  | {
      schema_version: 1;
      kind: "sequence";
      shots: CameraSequenceShotV1[];
      unsafe_overscan?: true;
    }
  | {
      schema_version: 1;
      kind: "reset";
      duration_ms: number;
      easing: VisualTransitionEasing;
    }
  | {
      schema_version: 1;
      kind: "shake";
      direction: CameraShakeDirection;
      intensity: number;
      duration_ms: number;
    }
  | {
      schema_version: 1;
      kind: "impact";
      direction: CameraImpactDirection;
      intensity: number;
      duration_ms: number;
    };

export interface StructuredCameraCommand {
  type: "camera";
  motion: CameraMotionV1;
  blocking: boolean;
  action?: never;
  params?: never;
}

export interface LegacyCameraCommand {
  type: "camera";
  action: string;
  params: Record<string, CameraJsonValue>;
  blocking: boolean;
  motion?: never;
}

export type CameraCommand = StructuredCameraCommand | LegacyCameraCommand;

export interface CameraValidationIssue {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning";
}

export interface CameraEventRef {
  scene_id: string;
  command_index: number;
  command_fingerprint: string;
}

export interface CameraExecutionRef extends CameraEventRef {
  engine_epoch: number;
  execution_id: number;
}

export interface CameraBlockingGate {
  lane: CameraLane;
  run_id: number;
  execution: CameraExecutionRef;
  phase: "running" | "awaiting_advance";
}

export interface CameraPoseMotionState {
  lane: "pose";
  run_id: number;
  event_ref: CameraEventRef;
  from: CameraPoseV1;
  to: CameraPoseV1;
  started_at: number;
  duration_ms: number;
  easing: VisualTransitionEasing;
  sequence_shots?: CameraSequenceShotV1[];
  blocking: boolean;
  authored_motion: Extract<CameraMotionV1, { kind: "reframe" | "sequence" | "reset" }>;
}

export interface CameraImpulseMotionState {
  lane: "impulse";
  run_id: number;
  event_ref: CameraEventRef;
  started_at: number;
  duration_ms: number;
  blocking: boolean;
  authored_motion: Extract<CameraMotionV1, { kind: "shake" | "impact" }>;
}

export interface CameraRuntimeState {
  persistent_pose: CameraPoseV1;
  pose_motion?: CameraPoseMotionState;
  impulse_motion?: CameraImpulseMotionState;
  blocking_gate?: CameraBlockingGate;
  next_run_id: number;
  revision: number;
}

export interface CameraImpulseFrame {
  offset_x: number;
  offset_y: number;
  zoom_delta: number;
}

export interface CameraVisualFrame {
  pose: CameraPoseV1;
  impulse: CameraImpulseFrame;
  pose_progress: number;
  impulse_progress: number;
  active: boolean;
}

export interface CameraMotionPolicy {
  reduced_motion?: boolean;
}

export const DEFAULT_CAMERA_POSE: CameraPoseV1 = Object.freeze({
  center_x: 0.5,
  center_y: 0.5,
  zoom: 1,
});

export const CAMERA_LIMITS = Object.freeze({
  centerMin: 0,
  centerMax: 1,
  normalZoomMin: 1,
  normalZoomMax: 2.5,
  advancedZoomMin: 0.5,
  advancedZoomMax: 4,
  poseDurationMinMs: 0,
  poseDurationMaxMs: 10_000,
  impulseDurationMinMs: 0,
  impulseDurationMaxMs: 3_000,
  intensityMin: 0,
  intensityMax: 1,
});

export const CAMERA_DEFAULTS = Object.freeze({
  reframeDurationMs: 1_400,
  resetDurationMs: 1_200,
  shakeDurationMs: 520,
  impactDurationMs: 380,
  shakeIntensity: 0.45,
  impactIntensity: 0.65,
  cinematicEasing: "cubic-bezier(0.22, 1, 0.36, 1)" as VisualTransitionEasing,
  resetEasing: "cubic-bezier(0.4, 0, 0.2, 1)" as VisualTransitionEasing,
});

const zeroImpulse: CameraImpulseFrame = Object.freeze({
  offset_x: 0,
  offset_y: 0,
  zoom_delta: 0,
});

const easingPresets = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
const numberPattern = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const cubicBezierPattern = new RegExp(
  `^cubic-bezier\\(\\s*(${numberPattern})\\s*,\\s*(${numberPattern})\\s*,\\s*(${numberPattern})\\s*,\\s*(${numberPattern})\\s*\\)$`,
);
export type CameraBezierControlPoints = [number, number, number, number];

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function issue(code: string, message: string, path: string, severity: "error" | "warning" = "error"): CameraValidationIssue {
  return { code, message, path, severity };
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: CameraValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    issues.push(issue(
      "camera_unknown_field",
      "这条运镜包含当前动作不需要的设置，请删除多余内容后重试。",
      `${path}.${key}`,
    ));
  }
}

export function cameraEasingControlPoints(value: unknown): CameraBezierControlPoints | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = cubicBezierPattern.exec(trimmed);
  if (!match) return undefined;
  const [x1, y1, x2, y2] = match.slice(1).map(Number) as CameraBezierControlPoints;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return undefined;
  if (y1 < -1 || y1 > 2 || y2 < -1 || y2 > 2) return undefined;
  return [x1, y1, x2, y2];
}

export function parseCameraEasing(value: unknown): VisualTransitionEasing | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (easingPresets.has(trimmed)) return trimmed as VisualTransitionEasing;
  const points = cameraEasingControlPoints(trimmed);
  if (!points) return undefined;
  const [x1, y1, x2, y2] = points;
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

export function cameraSafeCenterRange(zoom: number): { min: number; max: number } | undefined {
  if (!finiteNumber(zoom) || zoom < 1) return undefined;
  return { min: 0.5 / zoom, max: 1 - 0.5 / zoom };
}

export function isCameraPoseSafe(pose: CameraPoseV1): boolean {
  const range = cameraSafeCenterRange(pose.zoom);
  if (!range) return false;
  return pose.center_x >= range.min
    && pose.center_x <= range.max
    && pose.center_y >= range.min
    && pose.center_y <= range.max;
}

export function cameraMotionLane(kind: CameraMotionKind): CameraLane {
  return kind === "reframe" || kind === "sequence" || kind === "reset" ? "pose" : "impulse";
}

export function createInitialCameraState(pose: CameraPoseV1 = DEFAULT_CAMERA_POSE): CameraRuntimeState {
  return {
    persistent_pose: { ...pose },
    next_run_id: 1,
    revision: 0,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cubicCoordinate(t: number, first: number, second: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * first
    + 3 * inverse * t * t * second
    + t * t * t;
}

function cubicCoordinateDerivative(t: number, first: number, second: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * first
    + 6 * inverse * t * (second - first)
    + 3 * t * t * (1 - second);
}

function cubicBezierProgress(progress: number, x1: number, y1: number, x2: number, y2: number): number {
  const target = clamp01(progress);
  let parameter = target;
  for (let index = 0; index < 6; index += 1) {
    const difference = cubicCoordinate(parameter, x1, x2) - target;
    const derivative = cubicCoordinateDerivative(parameter, x1, x2);
    if (Math.abs(difference) < 0.00001 || Math.abs(derivative) < 0.000001) break;
    parameter = clamp01(parameter - difference / derivative);
  }
  let low = 0;
  let high = 1;
  for (let index = 0; index < 10; index += 1) {
    const sampledX = cubicCoordinate(parameter, x1, x2);
    if (Math.abs(sampledX - target) < 0.00001) break;
    if (sampledX < target) low = parameter;
    else high = parameter;
    parameter = (low + high) / 2;
  }
  return cubicCoordinate(parameter, y1, y2);
}

export function sampleCameraEasing(easing: VisualTransitionEasing, progress: number): number {
  const normalized = clamp01(progress);
  if (easing === "linear") return normalized;
  const presets: Record<string, readonly [number, number, number, number]> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  const preset = presets[easing];
  if (preset) return cubicBezierProgress(normalized, ...preset);
  const match = cubicBezierPattern.exec(easing);
  if (!match) return normalized;
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  return cubicBezierProgress(normalized, x1, y1, x2, y2);
}

function interpolatePose(from: CameraPoseV1, to: CameraPoseV1, progress: number): CameraPoseV1 {
  return {
    center_x: from.center_x + (to.center_x - from.center_x) * progress,
    center_y: from.center_y + (to.center_y - from.center_y) * progress,
    zoom: from.zoom + (to.zoom - from.zoom) * progress,
  };
}

function motionProgress(startedAt: number, durationMs: number, logicalNow: number): number {
  if (durationMs <= 0) return 1;
  return clamp01((logicalNow - startedAt) / durationMs);
}

export function cameraSequenceDuration(shots: readonly CameraSequenceShotV1[]): number {
  return shots.reduce((total, shot) => total + Math.max(0, shot.duration_ms), 0);
}

function samplePoseMotion(motion: CameraPoseMotionState, logicalNow: number): CameraPoseV1 {
  if (!motion.sequence_shots?.length) {
    const progress = motionProgress(motion.started_at, motion.duration_ms, logicalNow);
    return interpolatePose(motion.from, motion.to, sampleCameraEasing(motion.easing, progress));
  }

  let elapsed = Math.max(0, Math.min(motion.duration_ms, logicalNow - motion.started_at));
  let from = motion.from;
  for (const shot of motion.sequence_shots) {
    const duration = Math.max(0, shot.duration_ms);
    if (duration <= 0) {
      from = shot.to;
      continue;
    }
    if (elapsed < duration) {
      const eased = sampleCameraEasing(shot.easing, elapsed / duration);
      return interpolatePose(from, shot.to, eased);
    }
    elapsed -= duration;
    from = shot.to;
  }
  return { ...motion.to };
}

const shakeOffsets = [0, 0.12, 0.24, 0.38, 0.52, 0.66, 0.8, 0.9, 1] as const;
const shakePrimary = [0, -0.55, 0.85, -1, 0.72, -0.46, 0.28, -0.12, 0] as const;
const shakeSecondary = [0, 0.34, -0.62, 0.48, 0.78, -0.52, 0.26, -0.1, 0] as const;
const impactOffsets = [0, 0.08, 0.22, 0.42, 0.68, 1] as const;
const impactPrimary = [0, 1, -0.36, 0.16, -0.06, 0] as const;
const impactSecondary = [0, -0.55, 0.22, -0.1, 0.04, 0] as const;
const impactZoom = [0, 1, 0.42, 0.18, 0.05, 0] as const;

function sampleTemplate(
  offsets: readonly number[],
  values: readonly number[],
  progress: number,
): number {
  const normalized = clamp01(progress);
  for (let index = 1; index < offsets.length; index += 1) {
    if (normalized > offsets[index]) continue;
    const startOffset = offsets[index - 1];
    const endOffset = offsets[index];
    const segment = endOffset === startOffset ? 1 : (normalized - startOffset) / (endOffset - startOffset);
    return values[index - 1] + (values[index] - values[index - 1]) * segment;
  }
  return values[values.length - 1] ?? 0;
}

function sampleImpulse(motion: CameraImpulseMotionState, logicalNow: number): { frame: CameraImpulseFrame; progress: number } {
  const progress = motionProgress(motion.started_at, motion.duration_ms, logicalNow);
  if (progress >= 1 || motion.duration_ms <= 0) return { frame: { ...zeroImpulse }, progress: 1 };
  const authored = motion.authored_motion;
  const strength = authored.intensity;
  if (authored.kind === "shake") {
    const primary = sampleTemplate(shakeOffsets, shakePrimary, progress) * 0.012 * strength;
    const secondary = sampleTemplate(shakeOffsets, shakeSecondary, progress) * 0.012 * strength * 0.7;
    const offsetX = authored.direction === "vertical" ? 0 : primary;
    const offsetY = authored.direction === "horizontal" ? 0 : authored.direction === "vertical" ? primary : secondary;
    const safetyZoom = 2 * Math.max(Math.abs(offsetX), Math.abs(offsetY));
    return {
      frame: { offset_x: offsetX, offset_y: offsetY, zoom_delta: safetyZoom },
      progress,
    };
  }
  const primary = sampleTemplate(impactOffsets, impactPrimary, progress) * 0.018 * strength;
  const secondary = sampleTemplate(impactOffsets, impactSecondary, progress) * 0.018 * strength;
  const authoredZoom = sampleTemplate(impactOffsets, impactZoom, progress) * 0.015 * strength;
  let offsetX = 0;
  let offsetY = 0;
  if (authored.direction === "from_left") offsetX = primary;
  else if (authored.direction === "from_right") offsetX = -primary;
  else if (authored.direction === "from_top") offsetY = primary;
  else if (authored.direction === "from_bottom") offsetY = -primary;
  else {
    offsetX = primary;
    offsetY = secondary;
  }
  const safetyZoom = 2 * Math.max(Math.abs(offsetX), Math.abs(offsetY));
  return {
    frame: {
      offset_x: offsetX,
      offset_y: offsetY,
      zoom_delta: Math.max(authoredZoom, safetyZoom),
    },
    progress,
  };
}

export function sampleCamera(state: CameraRuntimeState, logicalNow: number): CameraVisualFrame {
  let pose = { ...state.persistent_pose };
  let poseProgress = 1;
  if (state.pose_motion) {
    poseProgress = motionProgress(state.pose_motion.started_at, state.pose_motion.duration_ms, logicalNow);
    pose = samplePoseMotion(state.pose_motion, logicalNow);
  }
  const impulseSample = state.impulse_motion
    ? sampleImpulse(state.impulse_motion, logicalNow)
    : { frame: { ...zeroImpulse }, progress: 1 };
  return {
    pose,
    impulse: impulseSample.frame,
    pose_progress: poseProgress,
    impulse_progress: impulseSample.progress,
    active: Boolean(
      (state.pose_motion && poseProgress < 1)
      || (state.impulse_motion && impulseSample.progress < 1),
    ),
  };
}

function effectiveMotion<T extends CameraMotionV1>(motion: T, policy: CameraMotionPolicy): T {
  if (!policy.reduced_motion) return structuredClone(motion);
  if (motion.kind === "sequence") {
    const totalDuration = cameraSequenceDuration(motion.shots);
    const durationScale = totalDuration > 120 ? 120 / totalDuration : 1;
    return {
      ...motion,
      shots: motion.shots.map((shot) => ({
        ...shot,
        to: { ...shot.to },
        duration_ms: shot.duration_ms * durationScale,
      })),
    } as T;
  }
  if (motion.kind === "reframe" || motion.kind === "reset") {
    return {
      ...motion,
      duration_ms: Math.min(motion.duration_ms, 120),
    } as T;
  }
  return {
    ...motion,
    duration_ms: Math.min(motion.duration_ms, 120),
    intensity: motion.intensity * 0.25,
  } as T;
}

export function startCameraEvent(
  state: CameraRuntimeState,
  command: StructuredCameraCommand,
  eventRef: CameraEventRef,
  logicalNow: number,
  policy: CameraMotionPolicy = {},
): CameraRuntimeState {
  const motion = effectiveMotion(command.motion, policy);
  const nextRunId = state.next_run_id;
  if (motion.kind === "reframe" || motion.kind === "sequence" || motion.kind === "reset") {
    const currentPose = sampleCamera(state, logicalNow).pose;
    const target = motion.kind === "reset"
      ? { ...DEFAULT_CAMERA_POSE }
      : motion.kind === "sequence"
        ? { ...motion.shots[motion.shots.length - 1].to }
        : { ...motion.to };
    const durationMs = motion.kind === "sequence"
      ? cameraSequenceDuration(motion.shots)
      : motion.duration_ms;
    if (durationMs <= 0) {
      return {
        ...state,
        persistent_pose: target,
        pose_motion: undefined,
        next_run_id: nextRunId + 1,
        revision: state.revision + 1,
      };
    }
    return {
      ...state,
      persistent_pose: currentPose,
      pose_motion: {
        lane: "pose",
        run_id: nextRunId,
        event_ref: { ...eventRef },
        from: currentPose,
        to: target,
        started_at: logicalNow,
        duration_ms: durationMs,
        easing: motion.kind === "sequence"
          ? motion.shots[0]?.easing ?? CAMERA_DEFAULTS.cinematicEasing
          : motion.easing,
        sequence_shots: motion.kind === "sequence"
          ? structuredClone(motion.shots)
          : undefined,
        blocking: command.blocking,
        authored_motion: structuredClone(command.motion) as Extract<CameraMotionV1, { kind: "reframe" | "sequence" | "reset" }>,
      },
      next_run_id: nextRunId + 1,
      revision: state.revision + 1,
    };
  }
  if (motion.duration_ms <= 0) {
    return {
      ...state,
      impulse_motion: undefined,
      next_run_id: nextRunId + 1,
      revision: state.revision + 1,
    };
  }
  return {
    ...state,
    impulse_motion: {
      lane: "impulse",
      run_id: nextRunId,
      event_ref: { ...eventRef },
      started_at: logicalNow,
      duration_ms: motion.duration_ms,
      blocking: command.blocking,
      authored_motion: motion,
    },
    next_run_id: nextRunId + 1,
    revision: state.revision + 1,
  };
}

export function finishCameraLane(
  state: CameraRuntimeState,
  lane: CameraLane,
  logicalNow: number,
  expectedRunId?: number,
): CameraRuntimeState {
  if (lane === "pose") {
    const motion = state.pose_motion;
    if (!motion || (expectedRunId !== undefined && motion.run_id !== expectedRunId)) return state;
    return {
      ...state,
      persistent_pose: { ...motion.to },
      pose_motion: undefined,
      revision: state.revision + 1,
    };
  }
  const motion = state.impulse_motion;
  if (!motion || (expectedRunId !== undefined && motion.run_id !== expectedRunId)) return state;
  return {
    ...state,
    impulse_motion: undefined,
    revision: state.revision + 1,
  };
}

export function isStructuredCameraCommand(value: unknown): value is StructuredCameraCommand {
  const command = recordValue(value);
  return command?.type === "camera" && Boolean(recordValue(command.motion));
}

export function isLegacyCameraCommand(value: unknown): value is LegacyCameraCommand {
  const command = recordValue(value);
  return command?.type === "camera"
    && command.motion === undefined
    && typeof command.action === "string"
    && Boolean(recordValue(command.params))
    && typeof command.blocking === "boolean";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function cameraCommandFingerprint(command: StructuredCameraCommand): string {
  const source = JSON.stringify(stableValue(command));
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `camera-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createDefaultCameraCommand(
  kind: CameraMotionKind,
  currentPose: CameraPoseV1 = DEFAULT_CAMERA_POSE,
): StructuredCameraCommand {
  if (kind === "sequence") {
    const reframe = createDefaultCameraCommand("reframe", currentPose);
    if (reframe.motion.kind !== "reframe") return reframe;
    const shot: CameraSequenceShotV1 = {
      to: { ...reframe.motion.to },
      duration_ms: CAMERA_DEFAULTS.reframeDurationMs,
      easing: CAMERA_DEFAULTS.cinematicEasing,
    };
    return {
      type: "camera",
      blocking: true,
      motion: {
        schema_version: 1,
        kind,
        shots: [structuredClone(shot), structuredClone(shot)],
      },
    };
  }
  if (kind === "reset") {
    return {
      type: "camera",
      blocking: true,
      motion: {
        schema_version: 1,
        kind,
        duration_ms: CAMERA_DEFAULTS.resetDurationMs,
        easing: CAMERA_DEFAULTS.resetEasing,
      },
    };
  }
  if (kind === "shake") {
    return {
      type: "camera",
      blocking: false,
      motion: {
        schema_version: 1,
        kind,
        direction: "omni",
        intensity: CAMERA_DEFAULTS.shakeIntensity,
        duration_ms: CAMERA_DEFAULTS.shakeDurationMs,
      },
    };
  }
  if (kind === "impact") {
    return {
      type: "camera",
      blocking: false,
      motion: {
        schema_version: 1,
        kind,
        direction: "omni",
        intensity: CAMERA_DEFAULTS.impactIntensity,
        duration_ms: CAMERA_DEFAULTS.impactDurationMs,
      },
    };
  }
  const zoom = Math.min(CAMERA_LIMITS.normalZoomMax, Math.max(1, currentPose.zoom * 1.12));
  const range = cameraSafeCenterRange(zoom);
  const centerX = range ? Math.min(range.max, Math.max(range.min, currentPose.center_x)) : currentPose.center_x;
  const centerY = range ? Math.min(range.max, Math.max(range.min, currentPose.center_y)) : currentPose.center_y;
  return {
    type: "camera",
    blocking: true,
    motion: {
      schema_version: 1,
      kind,
      to: { center_x: centerX, center_y: centerY, zoom },
      duration_ms: CAMERA_DEFAULTS.reframeDurationMs,
      easing: CAMERA_DEFAULTS.cinematicEasing,
    },
  };
}

function validateDuration(
  value: unknown,
  max: number,
  path: string,
  issues: CameraValidationIssue[],
): void {
  if (!finiteNumber(value) || value < 0 || value > max) {
    issues.push(issue("camera_duration", `运镜时长需要在 0 到 ${max} 毫秒之间。`, path));
  }
}

function validatePose(value: unknown, path: string, unsafeOverscan: boolean, issues: CameraValidationIssue[]): void {
  const pose = recordValue(value);
  if (!pose) {
    issues.push(issue("camera_pose", "请设置镜头的目标位置和缩放。", path));
    return;
  }
  validateAllowedFields(pose, new Set(["center_x", "center_y", "zoom"]), path, issues);
  const centerX = pose.center_x;
  const centerY = pose.center_y;
  const zoom = pose.zoom;
  if (!finiteNumber(centerX) || centerX < 0 || centerX > 1) {
    issues.push(issue("camera_center", "镜头横向中心需要在画面范围内。", `${path}.center_x`));
  }
  if (!finiteNumber(centerY) || centerY < 0 || centerY > 1) {
    issues.push(issue("camera_center", "镜头纵向中心需要在画面范围内。", `${path}.center_y`));
  }
  if (!finiteNumber(zoom) || zoom < CAMERA_LIMITS.advancedZoomMin || zoom > CAMERA_LIMITS.advancedZoomMax) {
    issues.push(issue("camera_zoom", "镜头缩放需要在 0.5 到 4 倍之间。", `${path}.zoom`));
  }
  if (
    finiteNumber(centerX)
    && finiteNumber(centerY)
    && finiteNumber(zoom)
    && centerX >= 0
    && centerX <= 1
    && centerY >= 0
    && centerY <= 1
    && zoom >= CAMERA_LIMITS.advancedZoomMin
    && zoom <= CAMERA_LIMITS.advancedZoomMax
    && !isCameraPoseSafe({ center_x: centerX, center_y: centerY, zoom })
    && !unsafeOverscan
  ) {
    issues.push(issue(
      "camera_unsafe_overscan",
      "这个构图会露出舞台边缘。请调整取景框，或在高级设置中明确允许露底。",
      path,
    ));
  }
}

export function validateStructuredCameraCommand(
  value: unknown,
  path = "camera",
): CameraValidationIssue[] {
  const issues: CameraValidationIssue[] = [];
  const command = recordValue(value);
  if (!command || command.type !== "camera") {
    return [issue("camera_command", "这条事件不是有效的运镜事件。", path)];
  }
  validateAllowedFields(command, new Set(["type", "motion", "blocking"]), path, issues);
  if (command.action !== undefined || command.params !== undefined) {
    issues.push(issue("camera_mixed_format", "这条运镜同时包含新旧设置。请保留其中一种格式。", path));
  }
  if (typeof command.blocking !== "boolean") {
    issues.push(issue("camera_blocking", "请选择镜头播放时是否等待结束。", `${path}.blocking`));
  }
  const motion = recordValue(command.motion);
  if (!motion) {
    issues.push(issue("camera_motion", "这条运镜缺少动作设置。", `${path}.motion`));
    return issues;
  }
  if (motion.schema_version !== 1) {
    issues.push(issue("camera_schema_version", "这个运镜版本暂不支持，请用当前编辑器重新保存。", `${path}.motion.schema_version`));
  }
  const kind = motion.kind;
  if (kind !== "reframe" && kind !== "sequence" && kind !== "reset" && kind !== "shake" && kind !== "impact") {
    issues.push(issue("camera_kind", "请选择推进、连续运镜、回正、震动或冲击。", `${path}.motion.kind`));
    return issues;
  }
  if (kind === "reframe") {
    validateAllowedFields(
      motion,
      new Set(["schema_version", "kind", "to", "duration_ms", "easing", "unsafe_overscan"]),
      `${path}.motion`,
      issues,
    );
    validateDuration(motion.duration_ms, CAMERA_LIMITS.poseDurationMaxMs, `${path}.motion.duration_ms`, issues);
    if (!parseCameraEasing(motion.easing)) {
      issues.push(issue("camera_easing", "缓动曲线无法使用，请选择预设或重新填写。", `${path}.motion.easing`));
    }
    validatePose(motion.to, `${path}.motion.to`, motion.unsafe_overscan === true, issues);
    if (motion.unsafe_overscan !== undefined && motion.unsafe_overscan !== true) {
      issues.push(issue("camera_unsafe_flag", "允许露底只能明确开启或保持关闭。", `${path}.motion.unsafe_overscan`));
    }
  } else if (kind === "sequence") {
    validateAllowedFields(
      motion,
      new Set(["schema_version", "kind", "shots", "unsafe_overscan"]),
      `${path}.motion`,
      issues,
    );
    if (command.blocking !== true) {
      issues.push(issue(
        "camera_sequence_blocking",
        "连续运镜必须等待整条路径播放结束后再继续剧情。",
        `${path}.blocking`,
      ));
    }
    if (!Array.isArray(motion.shots) || motion.shots.length < 2 || motion.shots.length > 4) {
      issues.push(issue(
        "camera_sequence_shots",
        "连续运镜需要包含 2 到 4 个目标镜头。",
        `${path}.motion.shots`,
      ));
    } else {
      motion.shots.forEach((value, index) => {
        const shotPath = `${path}.motion.shots[${index}]`;
        const shot = recordValue(value);
        if (!shot) {
          issues.push(issue("camera_sequence_shot", "目标镜头设置不完整。", shotPath));
          return;
        }
        validateAllowedFields(shot, new Set(["to", "duration_ms", "easing"]), shotPath, issues);
        validateDuration(
          shot.duration_ms,
          CAMERA_LIMITS.poseDurationMaxMs,
          `${shotPath}.duration_ms`,
          issues,
        );
        if (!parseCameraEasing(shot.easing)) {
          issues.push(issue(
            "camera_easing",
            "缓动曲线无法使用，请选择预设或重新填写。",
            `${shotPath}.easing`,
          ));
        }
        validatePose(shot.to, `${shotPath}.to`, motion.unsafe_overscan === true, issues);
      });
    }
    if (motion.unsafe_overscan !== undefined && motion.unsafe_overscan !== true) {
      issues.push(issue(
        "camera_unsafe_flag",
        "允许露底只能明确开启或保持关闭。",
        `${path}.motion.unsafe_overscan`,
      ));
    }
  } else if (kind === "reset") {
    validateAllowedFields(
      motion,
      new Set(["schema_version", "kind", "duration_ms", "easing"]),
      `${path}.motion`,
      issues,
    );
    validateDuration(motion.duration_ms, CAMERA_LIMITS.poseDurationMaxMs, `${path}.motion.duration_ms`, issues);
    if (!parseCameraEasing(motion.easing)) {
      issues.push(issue("camera_easing", "缓动曲线无法使用，请选择预设或重新填写。", `${path}.motion.easing`));
    }
  } else {
    validateAllowedFields(
      motion,
      new Set(["schema_version", "kind", "direction", "intensity", "duration_ms"]),
      `${path}.motion`,
      issues,
    );
    validateDuration(motion.duration_ms, CAMERA_LIMITS.impulseDurationMaxMs, `${path}.motion.duration_ms`, issues);
    if (!finiteNumber(motion.intensity) || motion.intensity < 0 || motion.intensity > 1) {
      issues.push(issue("camera_intensity", "效果强度需要在 0 到 1 之间。", `${path}.motion.intensity`));
    }
    if (kind === "shake" && motion.direction !== "horizontal" && motion.direction !== "vertical" && motion.direction !== "omni") {
      issues.push(issue("camera_direction", "请选择横向、纵向或全向震动。", `${path}.motion.direction`));
    }
    if (
      kind === "impact"
      && motion.direction !== "from_left"
      && motion.direction !== "from_right"
      && motion.direction !== "from_top"
      && motion.direction !== "from_bottom"
      && motion.direction !== "omni"
    ) {
      issues.push(issue("camera_direction", "请选择冲击来自哪个方向。", `${path}.motion.direction`));
    }
  }
  return issues;
}

export function validateCameraCommand(
  value: unknown,
  path = "camera",
): CameraValidationIssue[] {
  const command = recordValue(value);
  if (!command || command.type !== "camera") {
    return [issue("camera_command", "这条事件不是有效的运镜事件。", path)];
  }
  if (command.motion !== undefined) {
    return validateStructuredCameraCommand(command, path);
  }

  const issues: CameraValidationIssue[] = [];
  validateAllowedFields(command, new Set(["type", "action", "params", "blocking"]), path, issues);
  if (typeof command.action !== "string" || command.action.trim().length === 0) {
    issues.push(issue("camera_legacy_action", "这条旧版运镜缺少动作设置，请重新选择动作。", `${path}.action`));
  }
  if (!recordValue(command.params)) {
    issues.push(issue("camera_legacy_params", "这条旧版运镜的参数格式不完整，请重新保存。", `${path}.params`));
  }
  if (typeof command.blocking !== "boolean") {
    issues.push(issue("camera_blocking", "请选择镜头播放时是否等待结束。", `${path}.blocking`));
  }
  return issues;
}
