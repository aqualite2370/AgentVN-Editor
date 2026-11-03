import type { Choice, GameCommand } from "../types/commands";
import type { BackgroundFit, GameManifest } from "../types/manifest";
import type { CameraReplayRecord, CameraSaveStateV1, HistoryEntry, NvlLineState, SaveData } from "../types/save";
import type { RuntimeScene, RuntimeScript } from "../types/script";
import type { ActiveVideoState, BgmState, DialogState, FocusedImageState, RuntimeAnimationEffect, SfxEvent, SpriteState } from "../types/settings";
import { newId } from "../utils/id";
import { normalizeBackgroundFit } from "../utils/backgroundFit";
import { compileCharacterAnimation } from "../../../shared/animation/characterAnimation";
import {
  resolveVisualTransition,
  type NormalizedVisualTransitionConfig,
} from "../../../shared/animation/visualTransition";
import { inheritedSpriteLayer } from "../../../shared/cartridge/spriteLayer";
import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale } from "../../../shared/cartridge/spriteScale";
import { sanitizeSpriteOffsetX, sanitizeSpriteOffsetY } from "../../../shared/cartridge/spritePlacement";
import { normalizeBgmCommandFields } from "../../../shared/cartridge/bgmTransition";
import { resolveDialogPresentation } from "../../../shared/cartridge/dialogPresentation";
import {
  cameraCommandFingerprint,
  cameraMotionLane,
  createInitialCameraState,
  finishCameraLane,
  isLegacyCameraCommand,
  isStructuredCameraCommand,
  sampleCamera,
  startCameraEvent,
  validateStructuredCameraCommand,
  type CameraExecutionRef,
  type CameraLane,
  type CameraMotionV1,
  type CameraRuntimeState,
  type CameraVisualFrame,
  type StructuredCameraCommand,
} from "../../../shared/camera/cameraMotion";
import { createTextKey } from "./readProgress";
import { RuntimeClock, RuntimeScheduler, type RuntimeSuspensionReason } from "./runtimeClock";
import { evaluateCondition, updateRuntimeVariable, type RuntimeVariables } from "./runtimeVariables";
import type {
  LivePreviewPlaybackRate,
  PreviewPathStep,
  PreviewStartSpec,
} from "../../../shared/preview/livePreviewProtocol";

export interface StoryEngineState {
  playthroughId: number;
  currentSceneId: string;
  currentCommandIndex: number;
  background?: string;
  backgroundFit?: BackgroundFit;
  backgroundTransition?: NormalizedVisualTransitionConfig;
  backgroundTransitionKey: number;
  sprites: Record<string, SpriteState>;
  spriteOrder: string[];
  dialog?: DialogState;
  /** Restored dialogue is rendered without replaying the command's voice. */
  dialogRestored?: boolean;
  dialogPageIndex: number;
  dialogPageCount: number;
  dialogPageForwardIndex: number;
  nvlPresentationMode: "dialog" | "nvl" | "bubble";
  nvlPage: NvlLineState[];
  focusedImage?: FocusedImageState;
  activeVideo?: ActiveVideoState;
  choices: Choice[];
  variables: RuntimeVariables;
  history: HistoryEntry[];
  isTyping: boolean;
  typingRevealRequested: boolean;
  advanceQueuedAfterReveal: boolean;
  isWaitingChoice: boolean;
  isAutoMode: boolean;
  isSkipMode: boolean;
  isPaused: boolean;
  isEnded: boolean;
  isPreviewFrame: boolean;
  isGalleryReplay: boolean;
  bgmState?: BgmState;
  currentCommandType?: string;
  cameraEffect?: string;
  camera: CameraRuntimeState;
  cameraNotice?: string;
  animationHint?: string;
  animationEffects: RuntimeAnimationEffect[];
  sfxEvent?: SfxEvent;
  canRollback: boolean;
  canRollForward: boolean;
  rollbackSelectedChoiceId?: string;
  rollbackChoiceFixed: boolean;
}

const emptyState: StoryEngineState = {
  playthroughId: 0,
  currentSceneId: "",
  currentCommandIndex: 0,
  backgroundFit: "stretch",
  backgroundTransitionKey: 0,
  sprites: {},
  spriteOrder: [],
  dialogPageIndex: 0,
  dialogPageCount: 1,
  dialogPageForwardIndex: 0,
  nvlPresentationMode: "dialog",
  nvlPage: [],
  choices: [],
  variables: {},
  history: [],
  isTyping: false,
  typingRevealRequested: false,
  advanceQueuedAfterReveal: false,
  isWaitingChoice: false,
  isAutoMode: false,
  isSkipMode: false,
  isPaused: false,
  isEnded: false,
  isPreviewFrame: false,
  isGalleryReplay: false,
  camera: createInitialCameraState(),
  animationEffects: [],
  canRollback: false,
  canRollForward: false,
  rollbackChoiceFixed: false,
};

interface RollbackRecord {
  id: number;
  hard: boolean;
  commandType?: string;
  snapshot: SaveData;
  selectedChoiceId?: string;
  fixed?: boolean;
}

/** In-memory interruption state; never part of a portable save or cartridge. */
export interface PlaybackSessionCheckpoint {
  restore: () => boolean;
}

function recordRuntimeAnimationProbe(event: string, effect: RuntimeAnimationEffect, details?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const host = window as Window & { __AGENTVN_RUNTIME_ANIMATION_LOG__?: Array<Record<string, unknown>> };
  const list = host.__AGENTVN_RUNTIME_ANIMATION_LOG__ ?? [];
  list.push({
    time: performance.now(),
    event,
    effect_id: effect.effect_id,
    animation_id: effect.animation_id,
    target: effect.target,
    target_kind: effect.target_kind,
    target_id: effect.target_id,
    details,
  });
  host.__AGENTVN_RUNTIME_ANIMATION_LOG__ = list.slice(-500);
  window.dispatchEvent(new CustomEvent("agentvn:runtime-animation", { detail: host.__AGENTVN_RUNTIME_ANIMATION_LOG__[host.__AGENTVN_RUNTIME_ANIMATION_LOG__.length - 1] }));
}

function animationDuration(params: Record<string, import("../types/commands").JsonValue>): number {
  const value = Number(params.duration ?? params.duration_ms ?? 500);
  return Number.isFinite(value) ? Math.max(80, Math.min(10000, value)) : 500;
}

function animationDelay(params: Record<string, import("../types/commands").JsonValue>): number {
  const value = Number(params.delay_ms ?? params.delay ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(10000, value)) : 0;
}

function animationTotalDuration(params: Record<string, import("../types/commands").JsonValue>): number {
  return animationDuration(params) + animationDelay(params);
}

function animationTargetKind(target: string): RuntimeAnimationEffect["target_kind"] {
  const normalized = target.trim().toLowerCase();
  if (normalized === "screen" || normalized === "camera") return "screen";
  if (normalized === "background") return "background";
  if (normalized === "dialog" || normalized === "dialog_panel") return "dialog";
  if (normalized === "ui") return "ui";
  if (normalized.startsWith("sprite:") || normalized.length > 0) return "sprite";
  return "unknown";
}

function animationTargetId(target: string): string | undefined {
  const normalized = target.trim();
  if (normalized.toLowerCase().startsWith("sprite:")) return normalized.slice("sprite:".length);
  if (["screen", "camera", "background", "dialog", "dialog_panel", "ui"].includes(normalized.toLowerCase())) return undefined;
  return normalized || undefined;
}

const spriteExitAnimationIds = new Set([
  "sprite_fade_out",
  "sprite_slide_out_left",
  "sprite_slide_out_right",
]);

function isSpriteExitRuntimeAnimation(effect: RuntimeAnimationEffect): boolean {
  if (effect.target_kind !== "sprite") return false;
  if (effect.params.character_animation_phase === "exit") return true;
  return spriteExitAnimationIds.has(effect.animation_id);
}

function humanizeCharacterId(characterId: string): string {
  const trimmed = characterId.trim();
  if (!trimmed) return characterId;
  if (/[\u3400-\u9fff]/.test(trimmed)) return trimmed;
  if (/^(char|character)[_-][a-z0-9]{3,}$/i.test(trimmed)) return "未知角色";
  const stripped = trimmed.replace(/^(char|character)[_-]/i, "");
  return stripped
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || trimmed;
}

function clampNumber(value: number | null | undefined, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function focusedImageFromCommand(command: Extract<GameCommand, { type: "show_image" }>): FocusedImageState {
  return {
    image_id: command.image_id,
    image_fit: command.image_fit ?? "contain",
    image_display_name: command.image_display_name,
    caption: command.caption,
    alt: command.alt,
    backdrop_opacity: clampNumber(command.backdrop_opacity, 0, 0.9, 0.62),
    backdrop_blur_px: clampNumber(command.backdrop_blur_px, 0, 24, 12),
  };
}

function spritePositionRank(position?: string | null): number {
  if (position === "left") return 0;
  if (position === "center") return 1;
  if (position === "right") return 2;
  return 3;
}

function fallbackSpriteOrder(sprites: Record<string, SpriteState>): string[] {
  return Object.values(sprites)
    .filter((sprite) => sprite.visible)
    .sort((a, b) => {
      const rankDelta = spritePositionRank(a.position) - spritePositionRank(b.position);
      if (rankDelta !== 0) return rankDelta;
      return a.character_id.localeCompare(b.character_id, "zh-Hans-CN");
    })
    .map((sprite) => sprite.character_id);
}

function normalizeSpriteOrder(sprites: Record<string, SpriteState>, order?: string[]): string[] {
  const visibleIds = new Set(Object.values(sprites).filter((sprite) => sprite.visible).map((sprite) => sprite.character_id));
  const ordered = (order ?? []).filter((characterId, index, list) => visibleIds.has(characterId) && list.indexOf(characterId) === index);
  const missing = fallbackSpriteOrder(sprites).filter((characterId) => !ordered.includes(characterId));
  return [...ordered, ...missing];
}

function activeVideoFromCommand(command: Extract<GameCommand, { type: "video" }>): ActiveVideoState {
  return {
    video_id: command.video_id,
    video_fit: command.video_fit ?? "contain",
    fade_in_ms: clampNumber(command.fade_in_ms, 0, 10_000, 500),
    fade_out_ms: clampNumber(command.fade_out_ms, 0, 10_000, 500),
  };
}

function visualTransitionsEqual(
  left: NormalizedVisualTransitionConfig | undefined,
  right: NormalizedVisualTransitionConfig | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.kind === right.kind
    && left.duration_ms === right.duration_ms
    && left.easing === right.easing;
}

function normalizedSpritePlacement(position?: string | null): string {
  if (position === "left" || position === "right" || position === "center") return position;
  return "center";
}

function stripSpriteReplacement(sprites: Record<string, SpriteState>): Record<string, SpriteState> {
  return Object.fromEntries(
    Object.entries(sprites).map(([characterId, sprite]) => {
      const { replacement: _replacement, ...stableSprite } = sprite;
      return [characterId, stableSprite];
    }),
  );
}

export class StoryEngine {
  script?: RuntimeScript;
  manifest?: GameManifest;
  state: StoryEngineState = structuredClone(emptyState);
  onChange?: (state: StoryEngineState) => void;
  canSkipText?: (textKey: string) => boolean;
  onSkipBlocked?: (textKey: string) => void;
  onGalleryAnchor?: (command: Extract<GameCommand, { type: "gallery_anchor" }>, snapshot: SaveData) => void;
  shouldSuppressTransitions?: () => boolean;
  private automaticAdvanceCount = 0;
  private playthroughCounter = 0;
  private spriteReplacementCounter = 0;
  private previewSettling = false;
  private galleryReplaySceneId?: string;
  private engineEpoch = 0;
  private executionCounter = 0;
  private currentExecutionId = 0;
  private lastPreviewStartSpec?: PreviewStartSpec;
  private previewReducedMotionOverride?: boolean;
  readonly cameraClock = new RuntimeClock();
  private readonly cameraScheduler = new RuntimeScheduler(this.cameraClock);
  private readonly maxAutomaticAdvanceCount = 100;
  private rollbackRecords: RollbackRecord[] = [];
  private rollbackCursor = -1;
  private rollbackRecordCounter = 0;
  private rollbackSuspended = false;
  private atRollbackCheckpoint = false;
  private restoringRollback = false;
  private rollbackFixedThroughId = 0;
  private scriptRevision = 0;

  private defaultSpriteScale(): number {
    return sanitizeSpriteScale(this.script?.default_sprite_scale, DEFAULT_SPRITE_SCALE);
  }

  cameraFrame(): CameraVisualFrame {
    return sampleCamera(this.state.camera, this.cameraClock.now());
  }

  setCameraSuspended(reason: RuntimeSuspensionReason, suspended: boolean): void {
    this.changeCameraSuspension(reason, suspended, true);
  }

  private changeCameraSuspension(
    reason: RuntimeSuspensionReason,
    suspended: boolean,
    shouldEmit: boolean,
  ): void {
    if (!this.cameraScheduler.setSuspended(reason, suspended)) return;
    this.state.camera = {
      ...this.state.camera,
      revision: this.state.camera.revision + 1,
    };
    if (shouldEmit) this.emit();
  }

  private cameraTaskOwner(lane: CameraLane, runId: number, executionId: number): string {
    return `camera:${this.engineEpoch}:${lane}:${runId}:${executionId}`;
  }

  private cancelCameraLaneTask(lane: CameraLane): void {
    this.cameraScheduler.cancelMatching((owner) =>
      owner.startsWith(`camera:${this.engineEpoch}:${lane}:`)
    );
  }

  private prefersReducedCameraMotion(): boolean {
    if (this.previewReducedMotionOverride !== undefined) {
      return this.previewReducedMotionOverride;
    }
    return typeof window !== "undefined"
      && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }

  private executeStructuredCamera(command: Extract<GameCommand, { type: "camera" }>): void {
    if (!isStructuredCameraCommand(command)) return;
    const validationIssues = validateStructuredCameraCommand(command);
    if (validationIssues.length > 0) {
      this.state.cameraNotice = validationIssues[0].message;
      this.state.animationHint = validationIssues[0].message;
      this.emitAndContinue();
      return;
    }
    const lane = cameraMotionLane(command.motion.kind);
    this.cancelCameraLaneTask(lane);
    const execution: CameraExecutionRef = {
      scene_id: this.state.currentSceneId,
      command_index: this.state.currentCommandIndex,
      command_fingerprint: cameraCommandFingerprint(command),
      engine_epoch: this.engineEpoch,
      execution_id: this.currentExecutionId,
    };
    const logicalNow = this.cameraClock.now();
    const nextCamera = startCameraEvent(
      this.state.camera,
      command,
      execution,
      logicalNow,
      { reduced_motion: this.prefersReducedCameraMotion() },
    );
    const motion = lane === "pose" ? nextCamera.pose_motion : nextCamera.impulse_motion;
    this.state.cameraNotice = undefined;
    this.state.animationHint = undefined;
    this.state.camera = nextCamera;
    if (this.state.isSkipMode && motion) {
      this.state.camera = finishCameraLane(this.state.camera, lane, logicalNow + motion.duration_ms, motion.run_id);
      this.emit();
      if (this.noteAutomaticAdvance()) this.next(true);
      return;
    }
    if (!motion) {
      this.emit();
      if (command.blocking) this.next(true);
      else if (this.noteAutomaticAdvance()) this.next(true);
      return;
    }
    if (command.blocking) {
      this.resetAutomaticAdvance();
      this.state.camera = {
        ...this.state.camera,
        blocking_gate: {
          lane,
          run_id: motion.run_id,
          execution,
          phase: "running",
        },
      };
    }
    this.emit();
    const owner = this.cameraTaskOwner(lane, motion.run_id, execution.execution_id);
    this.cameraScheduler.schedule(owner, logicalNow + motion.duration_ms, () => {
      this.finishStructuredCamera(lane, motion.run_id, execution, "natural");
    });
    if (!command.blocking && this.noteAutomaticAdvance()) this.next(true);
  }

  private finishStructuredCamera(
    lane: CameraLane,
    runId: number,
    execution: CameraExecutionRef,
    cause: "natural" | "input",
  ): boolean {
    const active = lane === "pose" ? this.state.camera.pose_motion : this.state.camera.impulse_motion;
    if (!active || active.run_id !== runId) return false;
    if (execution.engine_epoch !== this.engineEpoch) return false;
    this.cameraScheduler.cancel(this.cameraTaskOwner(lane, runId, execution.execution_id));
    let nextCamera = finishCameraLane(this.state.camera, lane, this.cameraClock.now(), runId);
    const gate = nextCamera.blocking_gate;
    if (gate && gate.run_id === runId && gate.execution.execution_id === execution.execution_id) {
      nextCamera = cause === "input"
        ? {
            ...nextCamera,
            blocking_gate: { ...gate, phase: "awaiting_advance" },
          }
        : { ...nextCamera, blocking_gate: undefined };
    }
    this.state.camera = nextCamera;
    this.emit();
    if (cause === "natural" && gate?.execution.execution_id === execution.execution_id) {
      if (
        this.state.currentSceneId === execution.scene_id
        && this.state.currentCommandIndex === execution.command_index
      ) {
        this.next(true);
      }
    }
    return true;
  }

  private clearRollbackTimeline(): void {
    this.rollbackRecords = [];
    this.rollbackCursor = -1;
    this.rollbackRecordCounter = 0;
    this.rollbackSuspended = false;
    this.rollbackFixedThroughId = 0;
    this.atRollbackCheckpoint = false;
    this.syncRollbackAvailability();
  }

  private previousHardRollbackIndex(fromIndex: number): number {
    for (let index = Math.min(fromIndex, this.rollbackRecords.length - 1); index >= 0; index -= 1) {
      if (this.rollbackRecords[index]?.hard) return index;
    }
    return -1;
  }

  private nextHardRollbackIndex(fromIndex: number): number {
    for (let index = Math.max(0, fromIndex); index < this.rollbackRecords.length; index += 1) {
      if (this.rollbackRecords[index]?.hard) return index;
    }
    return -1;
  }

  private syncRollbackAvailability(): void {
    if (this.script?.rollback?.enabled === false) {
      this.state.canRollback = false;
      this.state.canRollForward = false;
      return;
    }
    const rollbackFrom = this.atRollbackCheckpoint ? this.rollbackCursor - 1 : this.rollbackCursor;
    this.state.canRollback = this.state.dialogPageIndex > 0
      || this.previousHardRollbackIndex(rollbackFrom) >= 0;
    this.state.canRollForward = this.state.dialogPageForwardIndex > this.state.dialogPageIndex
      || this.nextHardRollbackIndex(this.rollbackCursor + 1) >= 0;
  }

  private markRollbackDeparted(): void {
    if (!this.atRollbackCheckpoint) return;
    this.atRollbackCheckpoint = false;
    this.syncRollbackAvailability();
  }

  private recordRollbackCheckpoint(hard = true): void {
    if (this.script?.rollback?.enabled === false || this.rollbackSuspended || this.restoringRollback) return;
    const current = this.rollbackRecords[this.rollbackCursor];
    if (
      this.atRollbackCheckpoint
      && current
      && current.snapshot.scene_id === this.state.currentSceneId
      && current.snapshot.command_index === this.state.currentCommandIndex
      && current.commandType === this.state.currentCommandType
    ) {
      this.syncRollbackAvailability();
      return;
    }

    if (this.rollbackCursor < this.rollbackRecords.length - 1) {
      const next = this.rollbackRecords[this.rollbackCursor + 1];
      if (
        next
        && next.snapshot.scene_id === this.state.currentSceneId
        && next.snapshot.command_index === this.state.currentCommandIndex
        && next.commandType === this.state.currentCommandType
      ) {
        this.rollbackCursor += 1;
        this.atRollbackCheckpoint = true;
        this.syncRollbackAvailability();
        return;
      }
      this.rollbackRecords = this.rollbackRecords.slice(0, this.rollbackCursor + 1);
    }

    const record: RollbackRecord = {
      id: ++this.rollbackRecordCounter,
      hard,
      commandType: this.state.currentCommandType,
      snapshot: structuredClone(this.createSaveSnapshot(0)),
    };
    this.rollbackRecords.push(record);
    this.rollbackCursor = this.rollbackRecords.length - 1;
    this.atRollbackCheckpoint = true;

    const logLength = Math.max(2, Math.min(512, Math.round(this.script?.rollback?.log_length ?? 128)));
    const hardLimit = Math.max(0, Math.min(logLength, Math.round(this.script?.rollback?.hard_limit ?? 100)));
    while (this.rollbackRecords.length > logLength) {
      this.rollbackRecords.shift();
      this.rollbackCursor -= 1;
    }
    while (this.rollbackRecords.filter((item) => item.hard).length > hardLimit) {
      this.rollbackRecords.shift();
      this.rollbackCursor -= 1;
    }
    this.syncRollbackAvailability();
  }

  private restoreRollbackRecord(index: number): boolean {
    const record = this.rollbackRecords[index];
    if (!record) return false;
    this.restoringRollback = true;
    try {
      this.restoreSaveSnapshot(structuredClone(record.snapshot));
      if (record.snapshot.bgm_state === undefined) this.state.bgmState = undefined;
      this.state.currentCommandType = record.commandType;
      this.state.rollbackSelectedChoiceId = record.selectedChoiceId;
      this.state.rollbackChoiceFixed = Boolean(
        record.selectedChoiceId
        && (record.fixed || record.id <= this.rollbackFixedThroughId)
      );
      if (
        this.state.rollbackChoiceFixed
        && this.script?.rollback?.fixed_choice_mode === "selected_only"
        && record.selectedChoiceId
      ) {
        this.state.choices = this.state.choices.filter((choice) => choice.choice_id === record.selectedChoiceId);
      }
      this.state.isAutoMode = false;
      this.state.isSkipMode = false;
      this.state.isTyping = false;
      this.state.typingRevealRequested = Boolean(this.state.dialog);
      this.state.advanceQueuedAfterReveal = false;
      this.rollbackCursor = index;
      this.atRollbackCheckpoint = true;
      this.syncRollbackAvailability();
      this.emit();
      return true;
    } finally {
      this.restoringRollback = false;
    }
  }

  rollback(): boolean {
    if (this.state.dialogPageIndex > 0) {
      this.restoreDialogPage(this.state.dialogPageIndex - 1);
      return true;
    }
    const fromIndex = this.atRollbackCheckpoint ? this.rollbackCursor - 1 : this.rollbackCursor;
    const targetIndex = this.previousHardRollbackIndex(fromIndex);
    return targetIndex >= 0 ? this.restoreRollbackRecord(targetIndex) : false;
  }

  rollForward(): boolean {
    if (this.state.dialogPageForwardIndex > this.state.dialogPageIndex) {
      this.restoreDialogPage(this.state.dialogPageIndex + 1);
      return true;
    }
    const targetIndex = this.nextHardRollbackIndex(this.rollbackCursor + 1);
    return targetIndex >= 0 ? this.restoreRollbackRecord(targetIndex) : false;
  }

  private executeRollbackControl(command: Extract<GameCommand, { type: "rollback" }>): void {
    if (command.action === "checkpoint") {
      this.recordRollbackCheckpoint(command.hard !== false);
    } else if (command.action === "block") {
      this.recordRollbackCheckpoint(true);
      const current = this.rollbackRecords[this.rollbackCursor];
      this.rollbackRecords = current ? [current] : [];
      this.rollbackCursor = this.rollbackRecords.length - 1;
      this.atRollbackCheckpoint = Boolean(current);
      this.syncRollbackAvailability();
    } else if (command.action === "fix") {
      this.recordRollbackCheckpoint(true);
      const current = this.rollbackRecords[this.rollbackCursor];
      if (current) {
        current.fixed = true;
        this.rollbackFixedThroughId = Math.max(this.rollbackFixedThroughId, current.id);
      }
    } else if (command.action === "suspend") {
      this.rollbackSuspended = true;
    } else if (command.action === "resume") {
      this.rollbackSuspended = false;
    }
    this.emitAndContinue();
  }

  loadScript(script: RuntimeScript, manifest: GameManifest): void {
    this.scriptRevision += 1;
    this.script = script;
    this.manifest = manifest;
    this.clearRollbackTimeline();
    this.reset();
  }

  start(): void {
    if (!this.script) return;
    this.galleryReplaySceneId = undefined;
    this.clearRollbackTimeline();
    this.state = this.createFreshState();
    this.resetAutomaticAdvance();
    this.jumpToScene(this.script.entry_scene_id);
  }

  startGalleryReplay(sceneId: string): void {
    if (!this.script) return;
    if (!this.getScene(sceneId)) throw new Error(`画廊回放场景不存在：${sceneId}`);
    this.galleryReplaySceneId = sceneId;
    this.clearRollbackTimeline();
    this.state = this.createFreshState();
    this.resetAutomaticAdvance();
    this.jumpToScene(sceneId);
  }

  previewScene(
    sceneId: string,
    options: { stopAt: "first_stable_frame"; suppressTransientEffects?: boolean } = {
      stopAt: "first_stable_frame",
      suppressTransientEffects: true,
    },
  ): void {
    if (!this.script) return;
    this.galleryReplaySceneId = undefined;
    if (!this.getScene(sceneId)) {
      throw new Error(`场景编号不存在：${sceneId}`);
    }
    this.state = this.createFreshState();
    this.resetAutomaticAdvance();
    this.previewSettling = true;
    try {
      this.jumpToScene(sceneId);
    } finally {
      this.previewSettling = false;
    }
    if (options.suppressTransientEffects !== false) {
      this.state.backgroundTransition = undefined;
      this.state.animationEffects = [];
      this.state.cameraEffect = undefined;
      this.state.animationHint = undefined;
      this.state.sfxEvent = undefined;
      this.state.bgmState = undefined;
      this.state.sprites = stripSpriteReplacement(this.state.sprites);
      if (this.state.dialog) {
        this.state.dialog = { ...this.state.dialog, voice: undefined };
      }
    }
    this.state.isTyping = false;
    this.state.typingRevealRequested = Boolean(this.state.dialog);
    this.state.advanceQueuedAfterReveal = false;
    this.state.isPreviewFrame = true;
    this.emit();
  }

  previewStart(spec: PreviewStartSpec): void {
    if (!this.script) return;
    this.galleryReplaySceneId = undefined;
    const targetScene = this.getScene(spec.target.sceneId);
    if (!targetScene) {
      throw new Error(`找不到要预览的场景：${spec.target.sceneId}。请重新选择预览位置。`);
    }
    if (![0.5, 1, 2].includes(spec.playbackRate)) {
      throw new Error("预览速度不受支持，请选择 0.5 倍、1 倍或 2 倍。");
    }

    this.state = this.createFreshState();
    this.previewReducedMotionOverride = spec.reducedMotion;
    this.lastPreviewStartSpec = structuredClone(spec);
    this.cameraScheduler.setPlaybackRate(spec.playbackRate);
    this.resetAutomaticAdvance();
    this.previewSettling = true;
    try {
      let currentSceneId = spec.entryPath.length > 0
        ? this.script.entry_scene_id
        : spec.target.sceneId;
      this.state.currentSceneId = currentSceneId;

      for (const step of spec.entryPath) {
        if (step.sceneId !== currentSceneId) {
          throw new Error("预览路径已经失效，请重新选择进入这个场景的路线。");
        }
        const scene = this.getScene(currentSceneId);
        if (!scene) throw new Error("预览路径中的场景已不存在，请重新选择路线。");
        const exitIndex = step.kind === "scene_end" ? scene.commands.length : step.commandIndex;
        if (!Number.isInteger(exitIndex) || exitIndex < 0 || exitIndex > scene.commands.length) {
          throw new Error("预览路径中的事件位置已变化，请重新选择路线。");
        }
        this.reducePreviewCommands(scene, exitIndex);
        this.validatePreviewPathStep(scene, step);
        currentSceneId = step.targetSceneId;
        if (!this.getScene(currentSceneId)) {
          throw new Error("预览路径指向的场景已不存在，请重新选择路线。");
        }
        this.resetSceneLocalSpriteState();
        this.state.currentSceneId = currentSceneId;
        this.state.currentCommandIndex = 0;
      }

      if (currentSceneId !== spec.target.sceneId) {
        throw new Error("预览路径没有到达目标场景，请重新选择路线。");
      }

      const commandIndex = spec.target.commandIndex;
      if (commandIndex !== undefined) {
        if (!Number.isInteger(commandIndex) || commandIndex < 0 || commandIndex >= targetScene.commands.length) {
          throw new Error("要预览的事件位置已变化，请重新打开运镜工作室。");
        }
        this.reducePreviewCommands(targetScene, commandIndex);
        this.state.currentSceneId = targetScene.scene_id;
        this.state.currentCommandIndex = commandIndex;
        if (spec.mode === "play_target_event") {
          this.previewSettling = false;
          this.executeCurrentCommand();
        } else {
          this.applyPreviewStableCommand(targetScene.commands[commandIndex]);
        }
      } else {
        this.previewTargetStableFrame(targetScene);
      }
    } finally {
      this.previewSettling = false;
    }

    if (spec.mode === "stable_frame") {
      this.state.backgroundTransition = undefined;
      this.state.animationEffects = [];
      this.state.cameraEffect = undefined;
      this.state.animationHint = undefined;
      this.state.sfxEvent = undefined;
      this.state.bgmState = undefined;
      this.state.sprites = stripSpriteReplacement(this.state.sprites);
      if (this.state.dialog) this.state.dialog = { ...this.state.dialog, voice: undefined };
      this.state.isTyping = false;
      this.state.typingRevealRequested = Boolean(this.state.dialog);
      this.state.advanceQueuedAfterReveal = false;
      this.state.isPreviewFrame = true;
    }
    this.emit();
  }

  controlPreview(
    action: "pause" | "resume" | "replay" | "finish" | "set_playback_rate",
    playbackRate?: LivePreviewPlaybackRate,
  ): void {
    if (action === "pause") {
      this.setCameraSuspended("preview-control", true);
      return;
    }
    if (action === "resume") {
      this.setCameraSuspended("preview-control", false);
      return;
    }
    if (action === "replay") {
      if (this.lastPreviewStartSpec) this.previewStart(structuredClone(this.lastPreviewStartSpec));
      return;
    }
    if (action === "set_playback_rate") {
      if (playbackRate && this.cameraScheduler.setPlaybackRate(playbackRate)) {
        if (this.lastPreviewStartSpec) this.lastPreviewStartSpec.playbackRate = playbackRate;
        this.state.camera = {
          ...this.state.camera,
          revision: this.state.camera.revision + 1,
        };
        this.emit();
      }
      return;
    }
    let nextCamera = this.state.camera;
    const logicalNow = this.cameraClock.now();
    if (nextCamera.pose_motion) {
      this.cancelCameraLaneTask("pose");
      nextCamera = finishCameraLane(nextCamera, "pose", logicalNow, nextCamera.pose_motion.run_id);
    }
    if (nextCamera.impulse_motion) {
      this.cancelCameraLaneTask("impulse");
      nextCamera = finishCameraLane(nextCamera, "impulse", logicalNow, nextCamera.impulse_motion.run_id);
    }
    if (nextCamera.blocking_gate?.phase === "running") {
      nextCamera = {
        ...nextCamera,
        blocking_gate: { ...nextCamera.blocking_gate, phase: "awaiting_advance" },
      };
    }
    this.state.camera = nextCamera;
    this.emit();
  }

  private reducePreviewCommands(scene: RuntimeScene, endExclusive: number): void {
    this.state.currentSceneId = scene.scene_id;
    for (let index = 0; index < endExclusive; index += 1) {
      this.state.currentCommandIndex = index;
      this.applyPreviewPrefixCommand(scene.commands[index], index);
    }
    this.state.currentCommandIndex = endExclusive;
  }

  private applyPreviewPrefixCommand(command: GameCommand, commandIndex: number): void {
    switch (command.type) {
      case "background":
        this.state.background = command.background_id;
        this.state.backgroundFit = normalizeBackgroundFit(command.background_fit);
        this.state.backgroundTransition = undefined;
        this.state.backgroundTransitionKey += 1;
        return;
      case "sprite": {
        if (!command.visible) {
          const next = { ...this.state.sprites };
          delete next[command.character_id];
          this.state.sprites = next;
          this.state.spriteOrder = normalizeSpriteOrder(next, this.state.spriteOrder);
          return;
        }
        const existing = this.state.sprites[command.character_id];
        this.state.sprites = {
          ...this.state.sprites,
          [command.character_id]: {
            character_id: command.character_id,
            sprite_id: command.sprite_id || existing?.sprite_id || "",
            position: command.position ?? existing?.position,
            offset_x: sanitizeSpriteOffsetX(command.offset_x ?? existing?.offset_x),
            offset_y: sanitizeSpriteOffsetY(command.offset_y ?? existing?.offset_y),
            layer: inheritedSpriteLayer(command.layer, existing?.layer),
            animation: command.animation,
            animation_config: command.animation_config,
            scale: command.scale ?? existing?.scale ?? this.defaultSpriteScale(),
            visible: true,
          },
        };
        this.state.spriteOrder = normalizeSpriteOrder(
          this.state.sprites,
          [...this.state.spriteOrder, command.character_id],
        );
        return;
      }
      case "state_update":
        this.state.variables = updateRuntimeVariable(
          this.state.variables,
          command.key,
          command.operation,
          command.value,
          command.value_type,
        );
        return;
      case "hide_dialog":
        this.state.dialog = undefined;
        this.state.isTyping = false;
        this.state.typingRevealRequested = false;
        this.state.advanceQueuedAfterReveal = false;
        return;
      case "camera":
        if (!isStructuredCameraCommand(command) || validateStructuredCameraCommand(command).length > 0) return;
        if (cameraMotionLane(command.motion.kind) === "impulse") return;
        this.currentExecutionId = ++this.executionCounter;
        const previewRef: CameraExecutionRef = {
          scene_id: this.state.currentSceneId,
          command_index: commandIndex,
          command_fingerprint: cameraCommandFingerprint(command),
          engine_epoch: this.engineEpoch,
          execution_id: this.currentExecutionId,
        };
        const started = startCameraEvent(this.state.camera, command, previewRef, this.cameraClock.now());
        this.state.camera = started.pose_motion
          ? finishCameraLane(started, "pose", this.cameraClock.now(), started.pose_motion.run_id)
          : started;
        return;
      default:
        return;
    }
  }

  private validatePreviewPathStep(scene: RuntimeScene, step: PreviewPathStep): void {
    if (step.kind === "scene_end") {
      if (scene.next_scene_id !== step.targetSceneId) {
        throw new Error("场景的后续连接已经变化，请重新选择预览路线。");
      }
      return;
    }
    const command = scene.commands[step.commandIndex];
    if (step.kind === "choice") {
      if (command?.type !== "choice") {
        throw new Error("预览路线中的选项已经变化，请重新选择路线。");
      }
      const choice = command.choices.find((item) => item.choice_id === step.choiceId);
      if (!choice || choice.target_scene_id !== step.targetSceneId || !this.evaluateConditions(choice.conditions)) {
        throw new Error("预览路线中的选项当前不可用，请重新选择路线。");
      }
      return;
    }
    if (step.kind === "jump") {
      if (command?.type !== "jump" || command.target_scene_id !== step.targetSceneId) {
        throw new Error("预览路线中的跳转已经变化，请重新选择路线。");
      }
      return;
    }
    if (command?.type !== "conditional_jump") {
      throw new Error("预览路线中的条件出口已经变化，请重新选择路线。");
    }
    const matched = evaluateCondition(command.condition, this.state.variables);
    const actualTarget = matched ? command.target_scene_id : command.else_target_scene_id;
    const expectedBranch = matched ? "matched" : "fallback";
    if (step.branch !== expectedBranch || actualTarget !== step.targetSceneId) {
      throw new Error("预览路线的条件结果已经变化，请重新选择路线。");
    }
  }

  private previewTargetStableFrame(scene: RuntimeScene): void {
    const stableTypes = new Set<GameCommand["type"]>(["dialog", "narration", "choice", "show_image"]);
    const stableIndex = scene.commands.findIndex((command) => stableTypes.has(command.type));
    const targetIndex = stableIndex >= 0 ? stableIndex : scene.commands.length;
    this.reducePreviewCommands(scene, targetIndex);
    if (stableIndex >= 0) this.applyPreviewStableCommand(scene.commands[stableIndex]);
  }

  private applyPreviewStableCommand(command: GameCommand): void {
    if (
      command.type === "dialog"
      || command.type === "narration"
      || command.type === "choice"
      || command.type === "show_image"
    ) {
      this.previewSettling = false;
      this.executeCommand(command);
      this.previewSettling = true;
      return;
    }
    this.applyPreviewPrefixCommand(command, this.state.currentCommandIndex);
  }

  jumpToScene(sceneId: string, options?: { automatic?: boolean }): void {
    if (this.galleryReplaySceneId && sceneId !== this.galleryReplaySceneId) {
      this.state.isEnded = true;
      this.state.isPaused = true;
      this.emit();
      return;
    }
    const scene = this.getScene(sceneId);
    if (!scene) {
      throw new Error(`场景编号不存在：${sceneId}。剧情跳转指向了不存在的场景，请回到编辑器检查下一场景或选项目标。`);
    }
    if (!options?.automatic) this.resetAutomaticAdvance();
    this.resetSceneLocalSpriteState();
    this.state.currentSceneId = scene.scene_id;
    this.state.currentCommandIndex = 0;
    this.state.nvlPresentationMode = "dialog";
    this.state.nvlPage = [];
    this.state.choices = [];
    this.state.focusedImage = undefined;
    this.state.activeVideo = undefined;
    this.state.isWaitingChoice = false;
    this.state.isEnded = false;
    this.state.isPaused = false;
    this.emit();
    this.executeCurrentCommand();
  }

  private resetSceneLocalSpriteState(): void {
    this.state.sprites = {};
    this.state.spriteOrder = [];
    this.state.animationEffects = this.state.animationEffects.filter((effect) =>
      effect.target_kind !== "sprite" && !effect.target.startsWith("sprite:")
    );
  }

  next(automatic = false): void {
    if (this.state.isEnded || this.state.isPaused || this.state.isWaitingChoice || this.state.focusedImage || this.state.activeVideo) return;
    const cameraGate = this.state.camera.blocking_gate;
    if (!automatic && cameraGate?.phase === "running") {
      this.finishStructuredCamera(
        cameraGate.lane,
        cameraGate.run_id,
        cameraGate.execution,
        "input",
      );
      return;
    }
    if (!automatic && cameraGate?.phase === "awaiting_advance") {
      this.state.camera = {
        ...this.state.camera,
        blocking_gate: undefined,
        revision: this.state.camera.revision + 1,
      };
    }
    this.state.isPreviewFrame = false;
    if (!automatic) this.resetAutomaticAdvance();
    if (this.state.isTyping) {
      if (this.state.typingRevealRequested) {
        this.state.advanceQueuedAfterReveal = true;
      } else {
        this.state.typingRevealRequested = true;
        this.state.advanceQueuedAfterReveal = false;
      }
      this.emit();
      return;
    }
    this.markRollbackDeparted();
    this.state.currentCommandIndex += 1;
    this.executeCurrentCommand();
  }

  executeCurrentCommand(): void {
    const scene = this.currentScene();
    if (!scene) return;
    const command = scene.commands[this.state.currentCommandIndex];
    if (!command) {
      if (this.galleryReplaySceneId === scene.scene_id) {
        this.state.isEnded = true;
        this.state.isPaused = true;
        this.emit();
        return;
      }
      if (scene.is_ending) {
        this.state.isEnded = true;
        this.state.isPaused = true;
        this.emit();
        return;
      }
      if (scene.next_scene_id) {
        this.scheduleJumpToScene(scene.next_scene_id);
      } else if (scene.commands.length > 0) {
        // An unfinished scene has no explicit ending or successor. Keep its
        // last presentation saveable instead of letting auto/skip continually
        // advance beyond the script and produce an unreadable snapshot.
        this.state.currentCommandIndex = scene.commands.length - 1;
        this.state.isAutoMode = false;
        this.state.isSkipMode = false;
        this.resetAutomaticAdvance();
        this.emit();
      }
      return;
    }
    this.currentExecutionId = ++this.executionCounter;
    this.executeCommand(command);
  }

  playRuntimeAnimation(effect: RuntimeAnimationEffect, blocking: boolean, onFinish?: () => void): void {
    if (this.previewSettling) {
      onFinish?.();
      this.state.currentCommandIndex += 1;
      this.executeCurrentCommand();
      return;
    }
    if (this.state.isSkipMode || this.shouldSuppressTransitions?.()) {
      onFinish?.();
      if (blocking) this.next(true);
      else if (this.noteAutomaticAdvance()) this.next(true);
      return;
    }
    if (blocking) this.resetAutomaticAdvance();
    const stableEffect = {
      ...effect,
      playback_id: effect.playback_id ?? this.runtimeAnimationPlaybackId(effect),
    };
    recordRuntimeAnimationProbe("effect-created", stableEffect, { blocking, params: stableEffect.params, playback_id: stableEffect.playback_id });
    this.state.animationEffects = [...this.state.animationEffects.filter((item) => item.target !== stableEffect.target), stableEffect];
    this.state.animationHint = stableEffect.target_kind === "unknown" ? `???????${stableEffect.target}` : undefined;
    this.emit();
    this.scheduleForCurrentPlaythrough(() => {
      this.state.animationEffects = this.state.animationEffects.filter((item) => item.effect_id !== stableEffect.effect_id);
      this.state.animationHint = undefined;
      onFinish?.();
      recordRuntimeAnimationProbe("effect-finished", stableEffect, { blocking, playback_id: stableEffect.playback_id });
      if (blocking) this.next(true);
      else this.emit();
    }, stableEffect.duration_ms);
    if (!blocking && this.noteAutomaticAdvance()) this.next(true);
  }

  executeCommand(command: GameCommand): void {
    this.state.currentCommandType = command.type;
    if (command.type !== "choice") {
      this.state.rollbackSelectedChoiceId = undefined;
      this.state.rollbackChoiceFixed = false;
    }
    switch (command.type) {
      case "dialog":
        this.resetAutomaticAdvance();
        this.state.dialogRestored = false;
        this.state.dialogPageIndex = 0;
        this.state.dialogPageCount = 1;
        this.state.dialogPageForwardIndex = 0;
        const dialogPresentation = resolveDialogPresentation(command, this.script);
        if (dialogPresentation !== this.state.nvlPresentationMode) {
          this.state.nvlPage = [];
          this.state.nvlPresentationMode = dialogPresentation;
        }
        if (this.state.nvlPresentationMode === "nvl" && command.clear_nvl_page_before) {
          this.state.nvlPage = [];
        }
        const speaker = this.characterDisplayName(command.character_id);
        const dialogTextKey = this.currentTextKey(command.text);
        const dialogSkipsInstantly = this.textSkipsInstantly(dialogTextKey);
        this.state.dialog = {
          presentation_mode: dialogPresentation,
          bubble_position: command.bubble_position ? structuredClone(command.bubble_position) : undefined,
          character_id: command.character_id,
          speaker,
          text: command.text,
          text_key: dialogTextKey,
          emotion: command.emotion,
          portrait: command.portrait,
          voice: command.voice,
          font_asset_id: command.font_asset_id,
          dialog_style: command.dialog_style_mode === "manual" || command.dialog_style ? command.dialog_style ?? null : null,
          dialog_style_mode: command.dialog_style_mode ?? (command.dialog_style ? "manual" : "inherit"),
          isNarration: false,
        };
        if (this.state.nvlPresentationMode === "nvl") {
          this.state.nvlPage = [...this.state.nvlPage, {
            ...structuredClone(this.state.dialog),
            scene_id: this.state.currentSceneId,
            command_index: this.state.currentCommandIndex,
          }];
        }
        this.state.isTyping = !dialogSkipsInstantly;
        this.state.typingRevealRequested = false;
        this.state.advanceQueuedAfterReveal = false;
        this.pushHistory({
          speaker,
          text: command.text,
          emotion: command.emotion,
        });
        this.recordRollbackCheckpoint();
        this.emit();
        break;
      case "narration":
        this.resetAutomaticAdvance();
        this.state.dialogRestored = false;
        this.state.dialogPageIndex = 0;
        this.state.dialogPageCount = 1;
        this.state.dialogPageForwardIndex = 0;
        const narrationPresentation = resolveDialogPresentation(command, this.script);
        if (narrationPresentation !== this.state.nvlPresentationMode) {
          this.state.nvlPage = [];
          this.state.nvlPresentationMode = narrationPresentation;
        }
        if (this.state.nvlPresentationMode === "nvl" && command.clear_nvl_page_before) {
          this.state.nvlPage = [];
        }
        const narrationTextKey = this.currentTextKey(command.text);
        const narrationSkipsInstantly = this.textSkipsInstantly(narrationTextKey);
        this.state.dialog = {
          presentation_mode: narrationPresentation,
          bubble_position: command.bubble_position ? structuredClone(command.bubble_position) : undefined,
          speaker: undefined,
          text: command.text,
          text_key: narrationTextKey,
          font_asset_id: command.font_asset_id,
          dialog_style: command.dialog_style_mode === "manual" || command.dialog_style ? command.dialog_style ?? null : null,
          dialog_style_mode: command.dialog_style_mode ?? (command.dialog_style ? "manual" : "inherit"),
          narration_style: command.narration_style ?? "dialog",
          isNarration: true,
        };
        if (this.state.nvlPresentationMode === "nvl") {
          this.state.nvlPage = [...this.state.nvlPage, {
            ...structuredClone(this.state.dialog),
            scene_id: this.state.currentSceneId,
            command_index: this.state.currentCommandIndex,
          }];
        }
        this.state.isTyping = !narrationSkipsInstantly;
        this.state.typingRevealRequested = false;
        this.state.advanceQueuedAfterReveal = false;
        this.pushHistory({ speaker: "旁白", text: command.text });
        this.recordRollbackCheckpoint();
        this.emit();
        break;
      case "hide_dialog":
        this.state.dialog = undefined;
        this.state.isTyping = false;
        this.state.typingRevealRequested = false;
        this.state.advanceQueuedAfterReveal = false;
        this.emitAndContinue();
        break;
      case "background":
        const nextBackgroundFit = normalizeBackgroundFit(command.background_fit);
        const nextBackgroundTransition = resolveVisualTransition(
          command.transition_config,
          command.transition,
        );
        if (
          this.state.background === command.background_id
          && this.state.backgroundFit === nextBackgroundFit
          && visualTransitionsEqual(this.state.backgroundTransition, nextBackgroundTransition)
        ) {
          this.emitAndContinue();
          break;
        }
        this.state.background = command.background_id;
        this.state.backgroundFit = nextBackgroundFit;
        this.state.backgroundTransition = this.shouldSuppressTransitions?.() ? undefined : nextBackgroundTransition;
        this.state.backgroundTransitionKey += 1;
        this.emitAndContinue();
        break;
      case "show_image":
        this.resetAutomaticAdvance();
        this.changeCameraSuspension("focused-image", true, false);
        this.state.focusedImage = focusedImageFromCommand(command);
        this.state.isTyping = false;
        this.state.typingRevealRequested = false;
        this.state.advanceQueuedAfterReveal = false;
        this.emit();
        break;
      case "video":
        if (this.previewSettling) {
          this.state.currentCommandIndex += 1;
          this.executeCurrentCommand();
          break;
        }
        this.resetAutomaticAdvance();
        this.changeCameraSuspension("video", true, false);
        this.state.activeVideo = activeVideoFromCommand(command);
        this.state.isTyping = false;
        this.state.typingRevealRequested = false;
        this.state.advanceQueuedAfterReveal = false;
        this.recordRollbackCheckpoint();
        this.emit();
        break;
      case "sprite":
        const existingSprite = this.state.sprites[command.character_id];
        const nextSpriteId = command.sprite_id || existingSprite?.sprite_id || "";
        const nextPosition = command.position ?? existingSprite?.position;
        const nextOffsetX = sanitizeSpriteOffsetX(command.offset_x ?? existingSprite?.offset_x);
        const nextOffsetY = sanitizeSpriteOffsetY(command.offset_y ?? existingSprite?.offset_y);
        const nextScale = command.scale ?? existingSprite?.scale ?? this.defaultSpriteScale();
        const normalizedSwitchTransition = this.shouldSuppressTransitions?.()
          ? undefined
          : resolveVisualTransition(command.switch_transition);
        const isSamePlacement = Boolean(
          existingSprite
          && normalizedSpritePlacement(existingSprite.position) === normalizedSpritePlacement(nextPosition),
        );
        const isSpriteReplacement = Boolean(
          command.visible
          && existingSprite?.visible
          && existingSprite.sprite_id !== nextSpriteId
          && isSamePlacement
          && normalizedSwitchTransition
          && normalizedSwitchTransition.kind !== "none",
        );
        const replacement = isSpriteReplacement && existingSprite && normalizedSwitchTransition
          ? {
              previous_sprite_id: existingSprite.sprite_id,
              previous_position: existingSprite.position,
              previous_offset_x: existingSprite.offset_x,
              previous_offset_y: existingSprite.offset_y,
              previous_scale: existingSprite.scale,
              transition: normalizedSwitchTransition,
              key: ++this.spriteReplacementCounter,
            }
          : undefined;
        const spriteState: SpriteState = {
          character_id: command.character_id,
          sprite_id: nextSpriteId,
          position: nextPosition,
          offset_x: nextOffsetX,
          offset_y: nextOffsetY,
          layer: inheritedSpriteLayer(command.layer, existingSprite?.layer),
          animation: command.animation,
          animation_config: command.animation_config,
          scale: nextScale,
          visible: true,
          replacement,
        };
        const spriteAnimation = compileCharacterAnimation(command.animation_config, command.animation, null, command.visible);
        if (command.visible) {
          this.state.sprites = {
            ...this.state.sprites,
            [command.character_id]: spriteState,
          };
          this.state.spriteOrder = normalizeSpriteOrder(this.state.sprites, [...this.state.spriteOrder, command.character_id]);
          const isEntryAnimation = spriteAnimation?.params.character_animation_phase === "enter";
          if (spriteAnimation && !(replacement && isEntryAnimation)) {
            this.playRuntimeAnimation({
              effect_id: newId("anim"),
              animation_id: spriteAnimation.animation_id,
              target: `sprite:${command.character_id}`,
              target_kind: "sprite",
              target_id: command.character_id,
              params: spriteAnimation.params,
              started_at: Date.now(),
              duration_ms: animationTotalDuration(spriteAnimation.params),
            }, spriteAnimation.blocking);
          } else {
            this.emitAndContinue();
          }
          break;
        }
        if (spriteAnimation && existingSprite) {
          this.state.sprites = {
            ...this.state.sprites,
            [command.character_id]: {
              ...existingSprite,
              animation: command.animation,
              animation_config: command.animation_config,
              replacement: undefined,
              visible: true,
            },
          };
          this.playRuntimeAnimation({
            effect_id: newId("anim"),
            animation_id: spriteAnimation.animation_id,
            target: `sprite:${command.character_id}`,
            target_kind: "sprite",
            target_id: command.character_id,
            params: spriteAnimation.params,
            started_at: Date.now(),
            duration_ms: animationTotalDuration(spriteAnimation.params),
          }, spriteAnimation.blocking, () => {
            const next = { ...this.state.sprites };
            delete next[command.character_id];
            this.state.sprites = next;
            this.state.spriteOrder = normalizeSpriteOrder(next, this.state.spriteOrder);
          });
        } else {
          const next = { ...this.state.sprites };
          delete next[command.character_id];
          this.state.sprites = next;
          this.state.spriteOrder = normalizeSpriteOrder(next, this.state.spriteOrder);
          this.emitAndContinue();
        }
        break;
      case "choice":
        this.state.rollbackSelectedChoiceId = undefined;
        this.state.rollbackChoiceFixed = false;
        this.state.choices = command.choices
          .filter((choice) => this.evaluateConditions(choice.conditions))
          .map((choice) => ({
            ...choice,
            button_style: {
              ...(command.button_style ?? {}),
              ...(choice.button_style ?? {}),
            },
          }));
        if (this.state.choices.length === 0) {
          this.state.isWaitingChoice = false;
          this.state.animationHint = "选项全部被显示条件隐藏，已自动继续下一条事件。";
          this.emitAndContinue();
          break;
        }
        this.resetAutomaticAdvance();
        this.state.isWaitingChoice = true;
        this.recordRollbackCheckpoint();
        this.emit();
        break;
      case "state_update":
        this.state.variables = updateRuntimeVariable(this.state.variables, command.key, command.operation, command.value, command.value_type);
        this.emitAndContinue();
        break;
      case "jump":
        this.scheduleJumpToScene(command.target_scene_id);
        break;
      case "conditional_jump":
        if (evaluateCondition(command.condition, this.state.variables)) {
          this.scheduleJumpToScene(command.target_scene_id);
        } else if (command.else_target_scene_id) {
          this.scheduleJumpToScene(command.else_target_scene_id);
        } else {
          this.emitAndContinue();
        }
        break;
      case "animation":
        const duration = animationTotalDuration(command.params);
        const effect: RuntimeAnimationEffect = {
          effect_id: newId("anim"),
          animation_id: command.animation_id,
          target: command.target,
          target_kind: animationTargetKind(command.target),
          target_id: animationTargetId(command.target),
          params: command.params,
          started_at: Date.now(),
          duration_ms: duration,
        };
        if (isSpriteExitRuntimeAnimation(effect)) {
          const targetSpriteIds = this.spriteIdsTargetedByAnimation(effect);
          this.playRuntimeAnimation(effect, command.blocking, () => {
            this.removeSprites(targetSpriteIds);
          });
        } else {
          this.playRuntimeAnimation(effect, command.blocking);
        }
        break;
      case "bgm":
        if (this.previewSettling) {
          this.state.currentCommandIndex += 1;
          this.executeCurrentCommand();
          break;
        }
        this.state.bgmState = {
          bgm_id: command.bgm_id,
          ...normalizeBgmCommandFields(command as unknown as { action?: unknown; fade_ms?: unknown }),
          volume: command.volume,
        };
        this.emitAndContinue();
        break;
      case "sfx":
        if (this.previewSettling) {
          this.state.currentCommandIndex += 1;
          this.executeCurrentCommand();
          break;
        }
        this.state.sfxEvent = { id: newId("sfx"), sfx_id: command.sfx_id, volume: command.volume };
        this.emitAndContinue();
        break;
      case "camera":
        if (this.previewSettling) {
          if (isStructuredCameraCommand(command) && validateStructuredCameraCommand(command).length === 0) {
            const lane = cameraMotionLane(command.motion.kind);
            const previewRef: CameraExecutionRef = {
              scene_id: this.state.currentSceneId,
              command_index: this.state.currentCommandIndex,
              command_fingerprint: cameraCommandFingerprint(command),
              engine_epoch: this.engineEpoch,
              execution_id: this.currentExecutionId,
            };
            const started = startCameraEvent(
              this.state.camera,
              command,
              previewRef,
              this.cameraClock.now(),
            );
            const active = lane === "pose" ? started.pose_motion : started.impulse_motion;
            this.state.camera = active
              ? finishCameraLane(started, lane, this.cameraClock.now(), active.run_id)
              : started;
          }
          this.state.currentCommandIndex += 1;
          this.executeCurrentCommand();
          break;
        }
        if (isStructuredCameraCommand(command)) {
          this.executeStructuredCamera(command);
          break;
        }
        if (isLegacyCameraCommand(command)) {
          this.state.cameraEffect = command.action;
          if (command.blocking) this.resetAutomaticAdvance();
          this.emit();
          this.scheduleForCurrentPlaythrough(() => {
            this.state.cameraEffect = undefined;
            if (command.blocking) this.next(true);
            else this.emit();
          }, Number(command.params.duration ?? 450));
          if (!command.blocking && this.noteAutomaticAdvance()) this.next(true);
          break;
        }
        this.state.cameraNotice = "这条运镜格式不完整，已跳过。";
        this.state.animationHint = this.state.cameraNotice;
        this.emitAndContinue();
        break;
      case "wait":
        if (this.previewSettling) {
          this.state.currentCommandIndex += 1;
          this.executeCurrentCommand();
          break;
        }
        if (this.state.isSkipMode) {
          this.emitAndContinue();
          break;
        }
        if (this.script?.rollback?.pause_as_checkpoint) this.recordRollbackCheckpoint(false);
        this.resetAutomaticAdvance();
        this.emit();
        this.scheduleForCurrentPlaythrough(() => this.next(true), command.duration_ms);
        break;
      case "gallery_anchor": {
        const snapshot = this.createSaveSnapshot(0);
        snapshot.gallery_anchor_id = command.anchor_id;
        snapshot.command_index = this.state.currentCommandIndex + 1;
        this.onGalleryAnchor?.(command, snapshot);
        this.emitAndContinue();
        break;
      }
      case "rollback":
        this.executeRollbackControl(command);
        break;
    }
  }

  choose(choiceId: string): void {
    const choice = this.state.choices.find((item) => item.choice_id === choiceId);
    if (!choice) return;
    if (this.state.rollbackChoiceFixed && this.state.rollbackSelectedChoiceId !== choiceId) return;
    const currentRecord = this.rollbackRecords[this.rollbackCursor];
    if (currentRecord?.commandType === "choice") {
      const followsRecordedChoice = currentRecord.selectedChoiceId === choiceId;
      if (currentRecord.selectedChoiceId && !followsRecordedChoice) {
        this.rollbackRecords = this.rollbackRecords.slice(0, this.rollbackCursor + 1);
        this.syncRollbackAvailability();
      }
      currentRecord.selectedChoiceId = choiceId;
      if (followsRecordedChoice && this.state.canRollForward && this.rollForward()) return;
    }
    this.state.isPreviewFrame = false;
    this.state.isWaitingChoice = false;
    this.state.choices = [];
    this.markRollbackDeparted();
    this.resetAutomaticAdvance();
    this.jumpToScene(choice.target_scene_id);
  }

  completeTyping(textKey?: string): void {
    const currentTextKey = this.state.dialog?.text_key;
    if (textKey && currentTextKey && textKey !== currentTextKey) return;
    if (!this.state.isTyping && !this.state.typingRevealRequested && !this.state.advanceQueuedAfterReveal) return;
    const shouldAdvance = this.state.advanceQueuedAfterReveal;
    this.state.isTyping = false;
    this.state.typingRevealRequested = false;
    this.state.advanceQueuedAfterReveal = false;
    this.emit();
    if (shouldAdvance) {
      this.scheduleForCurrentPlaythrough(() => this.next(false), 0);
    }
  }

  dismissFocusedImage(): void {
    if (!this.state.focusedImage) return;
    this.state.isPreviewFrame = false;
    this.state.focusedImage = undefined;
    this.changeCameraSuspension("focused-image", false, false);
    this.resetAutomaticAdvance();
    this.markRollbackDeparted();
    this.state.currentCommandIndex += 1;
    this.executeCurrentCommand();
  }

  setDialogPagePosition(pageIndex: number, pageCount: number): void {
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) return;
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) return;
    if (this.state.dialogPageIndex === pageIndex && this.state.dialogPageCount === pageCount) return;
    this.state.dialogPageIndex = pageIndex;
    this.state.dialogPageCount = pageCount;
    this.state.dialogPageForwardIndex = pageIndex;
    const checkpoint = this.rollbackRecords[this.rollbackCursor];
    if (checkpoint && this.atRollbackCheckpoint) {
      checkpoint.snapshot.dialog_page_index = pageIndex;
      checkpoint.snapshot.dialog_page_count = pageCount;
    }
    this.syncRollbackAvailability();
    this.emit();
  }

  private restoreDialogPage(pageIndex: number): void {
    const forwardIndex = Math.max(this.state.dialogPageForwardIndex, this.state.dialogPageIndex);
    this.state.dialogPageIndex = pageIndex;
    this.state.dialogPageForwardIndex = forwardIndex;
    this.state.isTyping = false;
    this.state.typingRevealRequested = Boolean(this.state.dialog);
    this.state.advanceQueuedAfterReveal = false;
    const checkpoint = this.rollbackRecords[this.rollbackCursor];
    if (checkpoint && this.atRollbackCheckpoint) {
      checkpoint.snapshot.dialog_page_index = pageIndex;
      checkpoint.snapshot.dialog_page_count = this.state.dialogPageCount;
    }
    this.syncRollbackAvailability();
    this.emit();
  }

  completeActiveVideo(): void {
    if (!this.state.activeVideo) return;
    this.state.activeVideo = undefined;
    this.changeCameraSuspension("video", false, false);
    this.resetAutomaticAdvance();
    this.markRollbackDeparted();
    this.state.currentCommandIndex += 1;
    this.executeCurrentCommand();
  }

  evaluateConditions(conditions: Array<string | import("../types/commands").Condition>): boolean {
    return conditions.every((condition) => evaluateCondition(condition, this.state.variables));
  }

  updateVariable(key: string, operation: import("../types/commands").StateOperation, value: import("../types/commands").JsonValue, valueType?: import("../types/commands").StateValueType): void {
    this.state.variables = updateRuntimeVariable(this.state.variables, key, operation, value, valueType);
    this.emit();
  }

  pushHistory(entry: Pick<HistoryEntry, "speaker" | "text" | "emotion">): void {
    const scene = this.currentScene();
    this.state.history = [
      ...this.state.history,
      {
        id: newId("hist"),
        scene_id: scene?.scene_id ?? "",
        scene_title: scene?.title ?? "",
        speaker: entry.speaker,
        text: entry.text,
        emotion: entry.emotion,
        timestamp: new Date().toISOString(),
      },
    ];
  }

  private createCameraSaveState(): CameraSaveStateV1 {
    const camera = this.state.camera;
    const frame = this.cameraFrame();
    const activeReplays: CameraReplayRecord[] = [];
    const gate = camera.blocking_gate;
    const earliestStartedAt = Math.min(
      camera.pose_motion?.started_at ?? Number.POSITIVE_INFINITY,
      camera.impulse_motion?.started_at ?? Number.POSITIVE_INFINITY,
    );
    const replayStartOffset = (startedAt: number): number =>
      Number.isFinite(earliestStartedAt) ? Math.max(0, startedAt - earliestStartedAt) : 0;
    if (camera.pose_motion) {
      activeReplays.push({
        lane: "pose",
        event_ref: structuredClone(camera.pose_motion.event_ref),
        motion: structuredClone(camera.pose_motion.authored_motion),
        from: structuredClone(camera.pose_motion.from),
        start_offset_ms: replayStartOffset(camera.pose_motion.started_at),
        elapsed_ms: Math.max(0, this.cameraClock.now() - camera.pose_motion.started_at),
        blocking: camera.pose_motion.blocking,
        visual_only: !(gate?.lane === "pose" && gate.run_id === camera.pose_motion.run_id && gate.phase === "running"),
      });
    }
    if (camera.impulse_motion) {
      activeReplays.push({
        lane: "impulse",
        event_ref: structuredClone(camera.impulse_motion.event_ref),
        motion: structuredClone(camera.impulse_motion.authored_motion),
        start_offset_ms: replayStartOffset(camera.impulse_motion.started_at),
        elapsed_ms: Math.max(0, this.cameraClock.now() - camera.impulse_motion.started_at),
        blocking: camera.impulse_motion.blocking,
        visual_only: !(gate?.lane === "impulse" && gate.run_id === camera.impulse_motion.run_id && gate.phase === "running"),
      });
    }
    return {
      schema_version: 1,
      persistent_pose: structuredClone(camera.persistent_pose),
      visual_frame: {
        pose: structuredClone(frame.pose),
        impulse: structuredClone(frame.impulse),
      },
      active_replays: activeReplays,
      blocking_gate: gate ? structuredClone(gate) : undefined,
    };
  }

  capturePlaybackSession(): PlaybackSessionCheckpoint {
    const revision = this.scriptRevision;
    const snapshot = structuredClone(this.createSaveSnapshot());
    const rollback = structuredClone({
      records: this.rollbackRecords,
      cursor: this.rollbackCursor,
      counter: this.rollbackRecordCounter,
      suspended: this.rollbackSuspended,
      atCheckpoint: this.atRollbackCheckpoint,
      fixedThroughId: this.rollbackFixedThroughId,
      selectedChoiceId: this.state.rollbackSelectedChoiceId,
      choiceFixed: this.state.rollbackChoiceFixed,
      pageForwardIndex: this.state.dialogPageForwardIndex,
    });
    let consumed = false;
    return {
      restore: () => {
        if (consumed || revision !== this.scriptRevision) return false;
        consumed = true;
        // Keep ordinary disk-load semantics unchanged. Only a temporary
        // same-script interruption restores the private rollback timeline.
        this.restoreSaveSnapshot(snapshot);
        this.rollbackRecords = rollback.records;
        this.rollbackCursor = rollback.cursor;
        this.rollbackRecordCounter = rollback.counter;
        this.rollbackSuspended = rollback.suspended;
        this.atRollbackCheckpoint = rollback.atCheckpoint;
        this.rollbackFixedThroughId = rollback.fixedThroughId;
        this.state.rollbackSelectedChoiceId = rollback.selectedChoiceId;
        this.state.rollbackChoiceFixed = rollback.choiceFixed;
        this.state.dialogPageForwardIndex = rollback.pageForwardIndex;
        if (rollback.choiceFixed && this.script?.rollback?.fixed_choice_mode === "selected_only") {
          this.state.choices = this.state.choices.filter(choice => choice.choice_id === rollback.selectedChoiceId);
        }
        this.syncRollbackAvailability();
        this.emit();
        return true;
      },
    };
  }

  createSaveSnapshot(slot = 0): SaveData {
    const stableSprites = stripSpriteReplacement(this.state.sprites);
    return {
      save_version: 3,
      save_id: newId("save"),
      game_id: this.script?.game_id ?? this.manifest?.game_id ?? "unknown",
      slot,
      created_at: new Date().toISOString(),
      scene_id: this.state.currentSceneId,
      command_index: this.state.currentCommandIndex,
      variables: this.state.variables,
      history: this.state.history,
      background: this.state.background,
      background_fit: this.state.backgroundFit ?? "stretch",
      sprites: stableSprites,
      sprite_order: normalizeSpriteOrder(stableSprites, this.state.spriteOrder),
      bgm_state: this.state.bgmState ? structuredClone(this.state.bgmState) : undefined,
      dialog: this.state.dialog,
      dialog_page_index: this.state.dialogPageIndex,
      dialog_page_count: this.state.dialogPageCount,
      nvl_presentation_mode: this.state.nvlPresentationMode,
      nvl_page: structuredClone(this.state.nvlPage),
      focused_image: this.state.focusedImage,
      unlocked_gallery: [],
      playtime_seconds: 0,
      camera: this.createCameraSaveState(),
    };
  }

  restoreSaveSnapshot(snapshot: SaveData, options?: { autoAdvance?: boolean }): void {
    this.galleryReplaySceneId = undefined;
    if (!this.restoringRollback) this.clearRollbackTimeline();
    const scene = this.getScene(snapshot.scene_id);
    const command = scene?.commands[snapshot.command_index];
    const restoredSprites = stripSpriteReplacement(snapshot.sprites);
    this.state = {
      ...this.createFreshState(),
      currentSceneId: snapshot.scene_id,
      currentCommandIndex: snapshot.command_index,
      currentCommandType: command?.type,
      variables: snapshot.variables,
      history: snapshot.history,
      background: snapshot.background,
      backgroundFit: normalizeBackgroundFit(snapshot.background_fit),
      backgroundTransition: undefined,
      backgroundTransitionKey: 0,
      sprites: restoredSprites,
      spriteOrder: normalizeSpriteOrder(restoredSprites, snapshot.sprite_order),
      bgmState: snapshot.bgm_state
        ? structuredClone(snapshot.bgm_state)
        : { action: "stop", fade_ms: 0 },
      dialog: snapshot.dialog,
      dialogRestored: Boolean(snapshot.dialog),
      dialogPageIndex: Number.isSafeInteger(snapshot.dialog_page_index) && snapshot.dialog_page_index! >= 0
        ? snapshot.dialog_page_index!
        : 0,
      dialogPageCount: Number.isSafeInteger(snapshot.dialog_page_count) && snapshot.dialog_page_count! >= 1
        ? snapshot.dialog_page_count!
        : 1,
      dialogPageForwardIndex: Number.isSafeInteger(snapshot.dialog_page_index) && snapshot.dialog_page_index! >= 0
        ? snapshot.dialog_page_index!
        : 0,
      nvlPresentationMode: snapshot.nvl_presentation_mode
        ?? snapshot.dialog?.presentation_mode
        ?? (snapshot.nvl_page?.length ? "nvl" : "dialog"),
      nvlPage: structuredClone(snapshot.nvl_page ?? []),
      focusedImage: command?.type === "show_image"
        ? snapshot.focused_image ?? focusedImageFromCommand(command)
        : undefined,
      activeVideo: command?.type === "video" ? activeVideoFromCommand(command) : undefined,
      choices: [],
      isWaitingChoice: false,
      isTyping: false,
      isPaused: false,
      isEnded: false,
      animationEffects: [],
    };
    this.restoreCameraSaveState(snapshot.camera, snapshot);
    if (snapshot.command_index >= (scene?.commands.length ?? 0)) {
      this.state.currentCommandType = undefined;
      this.scheduleForCurrentPlaythrough(() => this.next(true), 0);
    } else if (command?.type === "choice") {
      this.state.choices = command.choices
        .filter((choice) => this.evaluateConditions(choice.conditions))
        .map((choice) => ({
          ...choice,
          button_style: {
            ...(command.button_style ?? {}),
            ...(choice.button_style ?? {}),
          },
        }));
      this.state.isWaitingChoice = this.state.choices.length > 0;
      this.state.currentCommandType = "choice";
      if (this.state.choices.length === 0) this.scheduleForCurrentPlaythrough(() => this.next(true), 0);
    }
    if (command?.type === "show_image") {
      this.state.currentCommandType = "show_image";
    }
    if (command?.type === "video") {
      this.state.currentCommandType = "video";
    }
    if (
      !this.restoringRollback
      && ["dialog", "narration", "choice", "show_image"].includes(this.state.currentCommandType ?? "")
    ) {
      this.recordRollbackCheckpoint();
    }
    this.emit();
    if (options?.autoAdvance) {
      this.scheduleForCurrentPlaythrough(() => this.executeCurrentCommand(), 0);
    }
  }

  private isValidSavedCameraPose(value: unknown): value is CameraRuntimeState["persistent_pose"] {
    if (!value || typeof value !== "object") return false;
    const pose = value as Record<string, unknown>;
    return typeof pose.center_x === "number"
      && Number.isFinite(pose.center_x)
      && pose.center_x >= 0
      && pose.center_x <= 1
      && typeof pose.center_y === "number"
      && Number.isFinite(pose.center_y)
      && pose.center_y >= 0
      && pose.center_y <= 1
      && typeof pose.zoom === "number"
      && Number.isFinite(pose.zoom)
      && pose.zoom >= 0.5
      && pose.zoom <= 4;
  }

  private isValidCameraReplayRecord(value: unknown): value is CameraReplayRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const replay = value as Record<string, unknown>;
    const eventRef = replay.event_ref;
    if (!eventRef || typeof eventRef !== "object" || Array.isArray(eventRef)) return false;
    const event = eventRef as Record<string, unknown>;
    return (replay.lane === "pose" || replay.lane === "impulse")
      && typeof event.scene_id === "string"
      && Number.isInteger(event.command_index)
      && (event.command_index as number) >= 0
      && typeof event.command_fingerprint === "string"
      && Boolean(replay.motion)
      && typeof replay.motion === "object"
      && !Array.isArray(replay.motion)
      && typeof replay.start_offset_ms === "number"
      && Number.isFinite(replay.start_offset_ms)
      && replay.start_offset_ms >= 0
      && replay.start_offset_ms <= 40_000
      && (
        replay.elapsed_ms === undefined
        || (
          typeof replay.elapsed_ms === "number"
          && Number.isFinite(replay.elapsed_ms)
          && replay.elapsed_ms >= 0
          && replay.elapsed_ms <= 40_000
        )
      )
      && typeof replay.blocking === "boolean"
      && typeof replay.visual_only === "boolean";
  }

  private restoreCameraSaveState(cameraSave: CameraSaveStateV1 | undefined, snapshot: SaveData): void {
    if (!cameraSave || cameraSave.schema_version !== 1) return;
    const restoreNotice = "镜头记录不完整，已按安全画面恢复。";
    let nextCamera = createInitialCameraState(
      this.isValidSavedCameraPose(cameraSave.persistent_pose)
        ? cameraSave.persistent_pose
        : undefined,
    );
    let shouldShowNotice = !this.isValidSavedCameraPose(cameraSave.persistent_pose);
    const scheduled: Array<{ lane: CameraLane; runId: number; execution: CameraExecutionRef; durationMs: number }> = [];

    const replayRecords = Array.isArray(cameraSave.active_replays)
      ? cameraSave.active_replays.slice(0, 2)
      : [];
    if (!Array.isArray(cameraSave.active_replays)) shouldShowNotice = true;
    const restoredLanes = new Set<CameraLane>();
    for (const replay of replayRecords) {
      if (!this.isValidCameraReplayRecord(replay) || restoredLanes.has(replay.lane)) {
        shouldShowNotice = true;
        continue;
      }
      const scene = this.getScene(replay.event_ref.scene_id);
      const source = scene?.commands[replay.event_ref.command_index];
      if (
        !isStructuredCameraCommand(source)
        || cameraCommandFingerprint(source) !== replay.event_ref.command_fingerprint
      ) {
        shouldShowNotice = true;
        continue;
      }
      const command: StructuredCameraCommand = {
        type: "camera",
        blocking: replay.blocking,
        motion: structuredClone(replay.motion),
      };
      if (
        validateStructuredCameraCommand(command).length > 0
        || cameraMotionLane(command.motion.kind) !== replay.lane
        || cameraCommandFingerprint(command) !== replay.event_ref.command_fingerprint
      ) {
        shouldShowNotice = true;
        continue;
      }
      if (replay.lane === "pose") {
        if (!this.isValidSavedCameraPose(replay.from)) {
          shouldShowNotice = true;
          continue;
        }
        nextCamera = { ...nextCamera, persistent_pose: structuredClone(replay.from) };
      }
      const execution: CameraExecutionRef = {
        ...replay.event_ref,
        engine_epoch: this.engineEpoch,
        execution_id: ++this.executionCounter,
      };
      this.currentExecutionId = execution.execution_id;
      const replayNow = this.cameraClock.now();
      nextCamera = startCameraEvent(
        nextCamera,
        command,
        execution,
        replayNow,
        { reduced_motion: this.prefersReducedCameraMotion() },
      );
      const active = replay.lane === "pose" ? nextCamera.pose_motion : nextCamera.impulse_motion;
      if (!active) continue;
      const sequenceElapsed = replay.motion.kind === "sequence"
        ? Math.min(active.duration_ms, replay.elapsed_ms ?? 0)
        : 0;
      const replayStartedAt = replayNow + replay.start_offset_ms - sequenceElapsed;
      nextCamera = replay.lane === "pose"
        ? {
            ...nextCamera,
            pose_motion: nextCamera.pose_motion
              ? { ...nextCamera.pose_motion, started_at: replayStartedAt }
              : undefined,
          }
        : {
            ...nextCamera,
            impulse_motion: nextCamera.impulse_motion
              ? { ...nextCamera.impulse_motion, started_at: replayStartedAt }
              : undefined,
          };
      restoredLanes.add(replay.lane);
      const savedGate = cameraSave.blocking_gate;
      const restoreBlockingGate = !replay.visual_only
        && savedGate?.phase === "running"
        && savedGate.lane === replay.lane
        && savedGate.execution.scene_id === replay.event_ref.scene_id
        && savedGate.execution.command_index === replay.event_ref.command_index;
      if (restoreBlockingGate) {
        nextCamera = {
          ...nextCamera,
          blocking_gate: {
            lane: replay.lane,
            run_id: active.run_id,
            execution,
            phase: "running",
          },
        };
      }
      scheduled.push({
        lane: replay.lane,
        runId: active.run_id,
        execution,
        durationMs: Math.max(0, replay.start_offset_ms + active.duration_ms - sequenceElapsed),
      });
    }

    const waitingGate = cameraSave.blocking_gate;
    if (
      waitingGate?.phase === "awaiting_advance"
      && waitingGate.execution.scene_id === snapshot.scene_id
      && waitingGate.execution.command_index === snapshot.command_index
    ) {
      nextCamera = {
        ...nextCamera,
        blocking_gate: {
          ...waitingGate,
          execution: {
            ...waitingGate.execution,
            engine_epoch: this.engineEpoch,
            execution_id: ++this.executionCounter,
          },
        },
      };
    }
    if (shouldShowNotice) nextCamera = { ...nextCamera, revision: nextCamera.revision + 1 };
    this.state.camera = nextCamera;
    this.state.cameraNotice = shouldShowNotice ? restoreNotice : undefined;
    this.state.animationHint = shouldShowNotice ? restoreNotice : undefined;
    for (const task of scheduled) {
      this.cameraScheduler.schedule(
        this.cameraTaskOwner(task.lane, task.runId, task.execution.execution_id),
        this.cameraClock.now() + task.durationMs,
        () => this.finishStructuredCamera(task.lane, task.runId, task.execution, "natural"),
      );
    }
  }

  reset(): void {
    this.galleryReplaySceneId = undefined;
    this.state = this.createFreshState();
    this.resetAutomaticAdvance();
    this.emit();
  }

  currentScene(): RuntimeScene | undefined {
    return this.getScene(this.state.currentSceneId);
  }

  getScene(sceneId: string): RuntimeScene | undefined {
    return this.script?.scenes.find((scene) => scene.scene_id === sceneId);
  }

  private characterDisplayName(characterId: string): string {
    const profile = this.script?.characters?.find((character) => {
      const aliases = character.aliases ?? [];
      return character.character_id === characterId || character.name === characterId || aliases.includes(characterId);
    });
    const name = profile?.name?.trim();
    if (name && !/^(char|character)[_-][a-z0-9]{3,}$/i.test(name)) return name;
    return humanizeCharacterId(characterId);
  }

  private currentTextKey(text: string): string {
    const scene = this.currentScene();
    return createTextKey(this.script?.game_id ?? this.manifest?.game_id, scene?.scene_id ?? this.state.currentSceneId, this.state.currentCommandIndex, text);
  }

  private textSkipsInstantly(textKey: string): boolean {
    if (!this.state.isSkipMode) return false;
    const allowed = this.canSkipText?.(textKey) ?? true;
    if (!allowed) {
      this.state.isSkipMode = false;
      this.onSkipBlocked?.(textKey);
      return false;
    }
    return true;
  }

  private runtimeAnimationPlaybackId(effect: RuntimeAnimationEffect): string {
    return [
      this.state.playthroughId,
      this.state.currentSceneId || "scene",
      this.state.currentCommandIndex,
      effect.target,
      effect.animation_id,
    ].join(":");
  }

  private spriteIdsTargetedByAnimation(effect: RuntimeAnimationEffect): string[] {
    if (effect.target_kind !== "sprite") return [];
    const visibleSpriteIds = normalizeSpriteOrder(this.state.sprites, this.state.spriteOrder);
    const targetId = effect.target_id?.trim();
    if (!targetId || targetId === "all") return visibleSpriteIds;
    if (targetId === "selected") return visibleSpriteIds.length > 0 ? [visibleSpriteIds[visibleSpriteIds.length - 1]] : [];
    return this.state.sprites[targetId]?.visible ? [targetId] : [];
  }

  private removeSprites(characterIds: string[]): void {
    if (characterIds.length === 0) return;
    const ids = new Set(characterIds);
    const next = { ...this.state.sprites };
    ids.forEach((characterId) => delete next[characterId]);
    this.state.sprites = next;
    this.state.spriteOrder = normalizeSpriteOrder(next, this.state.spriteOrder);
  }

  private emitAndContinue(): void {
    if (!this.noteAutomaticAdvance()) return;
    if (this.previewSettling) {
      this.state.currentCommandIndex += 1;
      this.executeCurrentCommand();
      return;
    }
    this.emit();
    this.scheduleForCurrentPlaythrough(() => this.next(true), 0);
  }

  private scheduleJumpToScene(sceneId: string): void {
    if (!this.noteAutomaticAdvance()) return;
    if (this.previewSettling) {
      this.jumpToScene(sceneId, { automatic: true });
      return;
    }
    this.emit();
    this.scheduleForCurrentPlaythrough(() => this.jumpToScene(sceneId, { automatic: true }), 0);
  }

  private createFreshState(): StoryEngineState {
    this.engineEpoch += 1;
    this.executionCounter = 0;
    this.currentExecutionId = 0;
    this.previewReducedMotionOverride = undefined;
    this.cameraScheduler.reset();
    this.playthroughCounter += 1;
    this.spriteReplacementCounter = 0;
    return {
      ...structuredClone(emptyState),
      playthroughId: this.playthroughCounter,
      isGalleryReplay: Boolean(this.galleryReplaySceneId),
    };
  }

  private scheduleForCurrentPlaythrough(callback: () => void, delay: number): void {
    const playthroughId = this.state.playthroughId;
    window.setTimeout(() => {
      if (this.state.playthroughId !== playthroughId) return;
      callback();
    }, delay);
  }

  private noteAutomaticAdvance(): boolean {
    this.automaticAdvanceCount += 1;
    if (this.automaticAdvanceCount <= this.maxAutomaticAdvanceCount) return true;
    this.state.isPaused = true;
    this.state.isWaitingChoice = false;
    this.state.choices = [];
    this.state.animationHint = `自动跳转超过 ${this.maxAutomaticAdvanceCount} 次仍未遇到对白、选项、等待或阻塞事件，已暂停以防止错误循环。`;
    this.state.currentCommandType = "auto_loop_guard";
    this.emit();
    return false;
  }

  private resetAutomaticAdvance(): void {
    this.automaticAdvanceCount = 0;
  }

  private emit(): void {
    this.onChange?.(structuredClone(this.state));
  }
}
