import {
  AlertTriangle,
  GripVertical,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { RuntimePreviewMask } from "../common/RuntimePreviewMask";
import { RichSelect } from "../common/RichSelect";
import { useRuntimePreviewTransition } from "../../hooks/useRuntimePreviewTransition";
import type { CameraCommand, GameCommand } from "../../types/commands";
import type { AssetRef } from "../../types/assets";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import {
  applyCharacterDialogStylesToScript,
  createEditorLivePreviewData,
} from "../../cartridge/exportCartridge";
import { applyProjectRuntimeSettingsToScript } from "../../utils/exportScript";
import { manifestAssetsFromProjectAssets } from "../../utils/projectAssets";
import type { RuntimeScript, Scene } from "../../../../shared/cartridge/types";
import type { VisualTransitionEasing } from "../../../../shared/animation/visualTransition";
import {
  CAMERA_DEFAULTS,
  CAMERA_LIMITS,
  DEFAULT_CAMERA_POSE,
  cameraEasingControlPoints,
  cameraSequenceDuration,
  cameraSafeCenterRange,
  createDefaultCameraCommand,
  createInitialCameraState,
  isCameraPoseSafe,
  isStructuredCameraCommand,
  sampleCamera,
  startCameraEvent,
  type CameraMotionKind,
  type CameraPoseV1,
  type CameraSequenceShotV1,
  type StructuredCameraCommand,
} from "../../../../shared/camera/cameraMotion";
import {
  LIVE_PREVIEW_PROTOCOL_VERSION,
  type LivePreviewRuntimeMessage,
  type PreviewStartSpec,
} from "../../../../shared/preview/livePreviewProtocol";
import {
  findPreviewEntryPaths,
  previewInheritedCameraPose,
} from "../../utils/previewEntryPaths";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

interface CameraStudioDialogProps {
  command: StructuredCameraCommand;
  legacyComparisonCommand?: Extract<CameraCommand, { action: string }>;
  commands: GameCommand[];
  commandIndex: number;
  sceneId: string;
  inserting?: boolean;
  onApply: (command: StructuredCameraCommand) => void;
  onClose: () => void;
}

interface VisibleSprite {
  characterId: string;
  spriteId: string;
  position: string;
  scale: number;
}

type FrameCorner = "north-west" | "north-east" | "south-west" | "south-east";
type CameraBezierPointIndex = 0 | 1 | 2 | 3;

const runtimePreviewUrl = new URL("./gamecli-preview/?preview=1&embedded=1", window.location.href).toString();
const runtimePreviewOrigin = new URL(runtimePreviewUrl).origin;
const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const sceneDefaultPathId = "__scene_default__";
const runtimeDockWidthStorageKey = "agentvn.cameraStudio.runtimeDockWidth";
const runtimeDockHeightStorageKey = "agentvn.cameraStudio.runtimeDockHeight";
const runtimeDockBreakpoint = 1120;
const runtimeDockDefaultWidth = 360;
const runtimeDockDefaultHeight = 280;
const defaultCustomEasingPoints = [0.25, 0.1, 0.25, 1] as const;
const cameraEasingOptions = [
  { value: CAMERA_DEFAULTS.cinematicEasing, label: "电影柔停" },
  { value: CAMERA_DEFAULTS.resetEasing, label: "平滑回正" },
  { value: "ease-in-out", label: "平滑" },
  { value: "ease-out", label: "柔停" },
  { value: "linear", label: "匀速" },
] as const satisfies readonly { value: VisualTransitionEasing; label: string }[];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function assetSource(asset: AssetRef | undefined): string | undefined {
  return asset?.metadata.data_url
    ?? asset?.metadata.blob_url
    ?? asset?.metadata.url
    ?? asset?.metadata.project_path
    ?? asset?.metadata.filePath;
}

function motionDuration(command: StructuredCameraCommand): number {
  return command.motion.kind === "sequence"
    ? cameraSequenceDuration(command.motion.shots)
    : command.motion.duration_ms;
}

function currentPoseBefore(commands: GameCommand[], commandIndex: number): CameraPoseV1 {
  let pose = { ...DEFAULT_CAMERA_POSE };
  for (const command of commands.slice(0, commandIndex)) {
    if (!isStructuredCameraCommand(command)) continue;
    if (command.motion.kind === "reset") pose = { ...DEFAULT_CAMERA_POSE };
    if (command.motion.kind === "reframe") pose = { ...command.motion.to };
    if (command.motion.kind === "sequence") {
      const lastShot = command.motion.shots[command.motion.shots.length - 1];
      if (lastShot) pose = { ...lastShot.to };
    }
  }
  return pose;
}

function visibleSpritesBefore(commands: GameCommand[], commandIndex: number): VisibleSprite[] {
  const sprites = new Map<string, VisibleSprite>();
  for (const command of commands.slice(0, commandIndex)) {
    if (command.type !== "sprite") continue;
    if (!command.visible) {
      sprites.delete(command.character_id);
      continue;
    }
    const previous = sprites.get(command.character_id);
    sprites.set(command.character_id, {
      characterId: command.character_id,
      spriteId: command.sprite_id || previous?.spriteId || "",
      position: command.position ?? previous?.position ?? "center",
      scale: command.scale ?? previous?.scale ?? 1,
    });
  }
  return [...sprites.values()];
}

function backgroundBefore(
  commands: GameCommand[],
  commandIndex: number,
): { id: string; fit: Extract<GameCommand, { type: "background" }>["background_fit"] } | undefined {
  let background: { id: string; fit: Extract<GameCommand, { type: "background" }>["background_fit"] } | undefined;
  for (const command of commands.slice(0, commandIndex)) {
    if (command.type === "background") {
      background = { id: command.background_id, fit: command.background_fit };
    }
  }
  return background;
}

function spriteCenter(position: string): number {
  if (position === "left") return 0.25;
  if (position === "right") return 0.75;
  return 0.5;
}

function motionName(kind: CameraMotionKind): string {
  if (kind === "sequence") return "连续运镜";
  if (kind === "reset") return "回正";
  if (kind === "shake") return "震动";
  if (kind === "impact") return "冲击";
  return "重新构图";
}

function safePose(pose: CameraPoseV1, advanced: boolean): CameraPoseV1 {
  const zoom = clamp(
    pose.zoom,
    advanced ? CAMERA_LIMITS.advancedZoomMin : CAMERA_LIMITS.normalZoomMin,
    advanced ? CAMERA_LIMITS.advancedZoomMax : CAMERA_LIMITS.normalZoomMax,
  );
  if (advanced) {
    return {
      center_x: clamp(pose.center_x, 0, 1),
      center_y: clamp(pose.center_y, 0, 1),
      zoom,
    };
  }
  const range = cameraSafeCenterRange(zoom);
  return {
    center_x: range ? clamp(pose.center_x, range.min, range.max) : 0.5,
    center_y: range ? clamp(pose.center_y, range.min, range.max) : 0.5,
    zoom,
  };
}

function reframeCommand(
  pose: CameraPoseV1,
  previous: StructuredCameraCommand,
  advanced: boolean,
): StructuredCameraCommand {
  const normalized = safePose(pose, advanced);
  const previousMotion = previous.motion;
  const duration = previousMotion.kind === "reframe"
    ? previousMotion.duration_ms
    : CAMERA_DEFAULTS.reframeDurationMs;
  const easing = previousMotion.kind === "reframe" || previousMotion.kind === "reset"
    ? previousMotion.easing
    : CAMERA_DEFAULTS.cinematicEasing;
  return {
    type: "camera",
    blocking: previous.blocking,
    motion: {
      schema_version: 1,
      kind: "reframe",
      to: normalized,
      duration_ms: duration,
      easing,
      ...(!isCameraPoseSafe(normalized) ? { unsafe_overscan: true as const } : {}),
    },
  };
}

function commandWithDuration(
  command: StructuredCameraCommand,
  durationMs: number,
  shotIndex = 0,
): StructuredCameraCommand {
  if (command.motion.kind === "sequence") {
    return {
      ...command,
      blocking: true,
      motion: {
        ...command.motion,
        shots: command.motion.shots.map((shot, index) => (
          index === shotIndex
            ? { ...shot, duration_ms: clamp(durationMs, 0, CAMERA_LIMITS.poseDurationMaxMs) }
            : shot
        )),
      },
    };
  }
  return {
    ...command,
    motion: {
      ...command.motion,
      duration_ms: clamp(
        durationMs,
        0,
        command.motion.kind === "reframe" || command.motion.kind === "reset"
          ? CAMERA_LIMITS.poseDurationMaxMs
          : CAMERA_LIMITS.impulseDurationMaxMs,
      ),
    },
  };
}

function commandWithEasing(
  command: StructuredCameraCommand,
  easing: VisualTransitionEasing,
  shotIndex = 0,
): StructuredCameraCommand {
  if (command.motion.kind === "sequence") {
    return {
      ...command,
      blocking: true,
      motion: {
        ...command.motion,
        shots: command.motion.shots.map((shot, index) => (
          index === shotIndex ? { ...shot, easing } : shot
        )),
      },
    };
  }
  if (command.motion.kind !== "reframe" && command.motion.kind !== "reset") return command;
  return { ...command, motion: { ...command.motion, easing } };
}

function shotEndProgress(shots: readonly CameraSequenceShotV1[], index: number): number {
  const total = cameraSequenceDuration(shots);
  if (total <= 0) return 1;
  return shots
    .slice(0, index + 1)
    .reduce((duration, shot) => duration + shot.duration_ms, 0) / total;
}

function activeSequenceShot(shots: readonly CameraSequenceShotV1[], progress: number): number {
  const total = cameraSequenceDuration(shots);
  if (total <= 0) return shots.length - 1;
  const elapsed = clamp(progress, 0, 1) * total;
  let boundary = 0;
  for (let index = 0; index < shots.length; index += 1) {
    boundary += shots[index].duration_ms;
    if (elapsed < boundary || index === shots.length - 1) return index;
  }
  return shots.length - 1;
}

function commandFrame(
  command: StructuredCameraCommand,
  currentPose: CameraPoseV1,
  progress: number,
  reducedMotion: boolean,
) {
  const state = startCameraEvent(
    createInitialCameraState(currentPose),
    command,
    { scene_id: "studio", command_index: 0, command_fingerprint: "studio" },
    0,
    { reduced_motion: reducedMotion },
  );
  const active = state.pose_motion ?? state.impulse_motion;
  const duration = active?.duration_ms ?? 0;
  return sampleCamera(state, duration * progress);
}

function draftScene(
  script: RuntimeScript,
  sceneId: string,
  commands: GameCommand[],
  commandIndex: number,
  command: GameCommand,
  inserting: boolean,
): RuntimeScript {
  const nextCommands = inserting
    ? [...commands.slice(0, commandIndex), command, ...commands.slice(commandIndex)]
    : commands.map((item, index) => index === commandIndex ? command : item);
  return {
    ...script,
    scenes: script.scenes.map((scene) => (
      scene.scene_id === sceneId ? { ...scene, commands: nextCommands } : scene
    )),
  };
}

function liveAssetUrls(assets: AssetRef[]): Record<string, string> {
  return Object.fromEntries(assets.flatMap((asset) => {
    const source = assetSource(asset);
    return source ? [[asset.asset_id, source]] : [];
  }));
}

export function CameraStudioDialog({
  command,
  legacyComparisonCommand,
  commands,
  commandIndex,
  sceneId,
  inserting = false,
  onApply,
  onClose,
}: CameraStudioDialogProps) {
  const [draft, setDraft] = useState<StructuredCameraCommand>(() => structuredClone(command));
  const [advanced, setAdvanced] = useState(
    command.motion.kind === "reframe"
      ? !isCameraPoseSafe(command.motion.to)
      : command.motion.kind === "sequence"
        ? command.motion.unsafe_overscan === true
        : false,
  );
  const [selectedShotIndex, setSelectedShotIndex] = useState(0);
  const [draggedShotIndex, setDraggedShotIndex] = useState<number>();
  const [playing, setPlaying] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<0.5 | 1 | 2>(1);
  const [reducedPreview, setReducedPreview] = useState(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [runtimeStatus, setRuntimeStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const [runtimeMessage, setRuntimeMessage] = useState("正在连接真实 GameCLI…");
  const [runtimeExpanded, setRuntimeExpanded] = useState(false);
  const [runtimeMinimized, setRuntimeMinimized] = useState(false);
  const [runtimeDockWidth, setRuntimeDockWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem(runtimeDockWidthStorageKey));
    return Number.isFinite(saved) ? saved : runtimeDockDefaultWidth;
  });
  const [runtimeDockHeight, setRuntimeDockHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem(runtimeDockHeightStorageKey));
    return Number.isFinite(saved) ? saved : runtimeDockDefaultHeight;
  });
  const [runtimeComparison, setRuntimeComparison] = useState<"structured" | "legacy">("structured");
  const [stageSize, setStageSize] = useState({ width: 1280, height: 720 });
  const [announceText, setAnnounceText] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageDeckRef = useRef<HTMLDivElement>(null);
  const runtimeShellRef = useRef<HTMLElement>(null);
  const runtimeRestoreButtonRef = useRef<HTMLButtonElement>(null);
  const spritePreviewRefs = useRef(new Map<string, HTMLImageElement>());
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const animationRef = useRef<number>();
  const startedAtRef = useRef(performance.now());
  const startPlayheadRef = useRef(0);
  const announceTimerRef = useRef<number>();
  const syncTimerRef = useRef<number>();
  const syncRevisionRef = useRef(0);
  const syncSessionRef = useRef(globalThis.crypto?.randomUUID?.() ?? `camera-studio-${Date.now()}`);
  const syncRunRef = useRef(0);
  const activeRuntimeRunIdRef = useRef("");
  const initializedRef = useRef(false);
  const initialSerializedRef = useRef(JSON.stringify(command));
  const runtimeTransition = useRuntimePreviewTransition({
    containerRef: runtimeShellRef,
    initialize: initializeRuntimePreview,
    requestFreezeFrame: requestRuntimeFreezeFrame,
    pause: () => sendRuntimeControl("pause"),
    resume: () => {
      if (playing) sendRuntimeControl("resume");
    },
    reducedMotion: reducedPreview,
  });
  const project = useProjectStore();
  const editorNodes = useEditorStore((state) => state.nodes);
  const editorEdges = useEditorStore((state) => state.edges);
  const assets = project.assetManifest;
  const targetNodeId = editorNodes.find((node) => node.data.scene?.scene_id === sceneId)?.id;
  const pathCandidates = useMemo(
    () => targetNodeId ? findPreviewEntryPaths(editorNodes, editorEdges, targetNodeId) : [],
    [editorEdges, editorNodes, targetNodeId],
  );
  const pathStorageKey = `agentvn.cameraPreviewPath.${sceneId}`;
  const [selectedPathId, setSelectedPathId] = useState(() => window.localStorage.getItem(pathStorageKey) ?? "");
  const selectedPath = pathCandidates.find((candidate) => candidate.id === selectedPathId)
    ?? (pathCandidates.length === 1 ? pathCandidates[0] : undefined);
  const usingSceneDefault = selectedPathId === sceneDefaultPathId;
  const previewScript = useMemo(() => {
    const script = useEditorStore.getState().exportScript() as RuntimeScript;
    return {
      ...script,
      scenes: script.scenes.map((scene) => (
        scene.scene_id === sceneId ? { ...scene, commands } : scene
      )),
    };
  }, [commands, editorEdges, editorNodes, sceneId]);
  const pathPoseSummaries = useMemo(
    () => pathCandidates.map((candidate) => ({
      ...candidate,
      pose: previewInheritedCameraPose(previewScript, candidate.steps, sceneId, commandIndex),
    })),
    [commandIndex, pathCandidates, previewScript, sceneId],
  );
  const currentPose = useMemo(
    () => selectedPath
      ? previewInheritedCameraPose(previewScript, selectedPath.steps, sceneId, commandIndex)
      : currentPoseBefore(commands, commandIndex),
    [commandIndex, commands, previewScript, sceneId, selectedPath],
  );
  const sprites = useMemo(() => visibleSpritesBefore(commands, commandIndex), [commandIndex, commands]);
  const background = useMemo(() => backgroundBefore(commands, commandIndex), [commandIndex, commands]);
  const backgroundAsset = assets.find((asset) => asset.asset_id === background?.id);
  const frame = useMemo(
    () => commandFrame(draft, currentPose, playhead, reducedPreview),
    [currentPose, draft, playhead, reducedPreview],
  );
  const sequenceMotion = draft.motion.kind === "sequence" ? draft.motion : undefined;
  const selectedShot = sequenceMotion?.shots[
    Math.min(selectedShotIndex, sequenceMotion.shots.length - 1)
  ];
  const targetPose = draft.motion.kind === "reframe"
    ? draft.motion.to
    : selectedShot
      ? selectedShot.to
    : draft.motion.kind === "reset"
      ? DEFAULT_CAMERA_POSE
      : currentPose;
  const isDirty = JSON.stringify(draft) !== initialSerializedRef.current;
  const overscan = draft.motion.kind === "reframe"
    ? !isCameraPoseSafe(draft.motion.to)
    : sequenceMotion?.shots.some((shot) => !isCameraPoseSafe(shot.to)) ?? false;
  const sourceDensity = backgroundAsset?.metadata.width && backgroundAsset.metadata.height
    ? (background?.fit === "contain" ? Math.max : Math.min)(
        backgroundAsset.metadata.width / (Math.max(1, stageSize.width) * targetPose.zoom),
        backgroundAsset.metadata.height / (Math.max(1, stageSize.height) * targetPose.zoom),
      )
    : undefined;
  const reframeMotion = draft.motion.kind === "reframe" ? draft.motion : undefined;
  const impulseMotion = draft.motion.kind === "shake" || draft.motion.kind === "impact"
    ? draft.motion
    : undefined;
  const poseEasing = selectedShot?.easing
    ?? (draft.motion.kind === "reframe" || draft.motion.kind === "reset"
      ? draft.motion.easing
      : undefined);
  const poseDurationMs = selectedShot?.duration_ms
    ?? (draft.motion.kind === "sequence" ? 0 : draft.motion.duration_ms);
  const easingChoice = poseEasing && cameraEasingOptions.some((option) => option.value === poseEasing)
    ? poseEasing
    : "custom";
  const customEasingPoints = cameraEasingControlPoints(poseEasing)
    ?? [...defaultCustomEasingPoints];
  const playbackShotIndex = sequenceMotion && playing
    ? activeSequenceShot(sequenceMotion.shots, playhead)
    : selectedShotIndex;
  const identicalShotIndices = sequenceMotion
    ? sequenceMotion.shots.flatMap((shot, index) => {
        const previous = index === 0 ? currentPose : sequenceMotion.shots[index - 1].to;
        const identical = Math.abs(previous.center_x - shot.to.center_x) < 0.0001
          && Math.abs(previous.center_y - shot.to.center_y) < 0.0001
          && Math.abs(previous.zoom - shot.to.zoom) < 0.0001;
        return identical ? [index] : [];
      })
    : [];

  useEffect(() => {
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(focusableSelector);
    first?.focus();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (announceTimerRef.current) window.clearTimeout(announceTimerRef.current);
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (pathCandidates.length === 1 && selectedPathId !== pathCandidates[0].id) {
      setSelectedPathId(pathCandidates[0].id);
    }
  }, [pathCandidates, selectedPathId]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setStageSize((current) => (
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      ));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(stage);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(runtimeDockWidthStorageKey, String(runtimeDockWidth));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [runtimeDockWidth]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(runtimeDockHeightStorageKey, String(runtimeDockHeight));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [runtimeDockHeight]);

  useEffect(() => {
    const clampSavedSize = () => {
      const horizontal = window.innerWidth >= runtimeDockBreakpoint;
      const { minimum, maximum } = runtimeDockLimit(horizontal);
      if (horizontal) setRuntimeDockWidth((current) => clamp(current, minimum, maximum));
      else setRuntimeDockHeight((current) => clamp(current, minimum, maximum));
    };
    window.addEventListener("resize", clampSavedSize);
    return () => window.removeEventListener("resize", clampSavedSize);
  }, []);

  useEffect(() => {
    if (!playing) return;
    startedAtRef.current = performance.now();
    startPlayheadRef.current = playhead;
    const authoredDuration = motionDuration(draft);
    const duration = Math.max(1, reducedPreview ? Math.min(authoredDuration, 120) : authoredDuration);
    const tick = (now: number) => {
      const elapsed = (now - startedAtRef.current) * playbackRate;
      const next = startPlayheadRef.current + elapsed / duration;
      if (next >= 1) {
        setPlayhead(1);
        setPlaying(false);
        return;
      }
      setPlayhead(next);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [draft, playbackRate, playing, reducedPreview]);

  useEffect(() => {
    if (announceTimerRef.current) window.clearTimeout(announceTimerRef.current);
    announceTimerRef.current = window.setTimeout(() => {
      setAnnounceText(`目标中心横向 ${Math.round(targetPose.center_x * 100)}%，纵向 ${Math.round(targetPose.center_y * 100)}%，缩放 ${targetPose.zoom.toFixed(2)} 倍。`);
    }, 220);
  }, [targetPose.center_x, targetPose.center_y, targetPose.zoom]);

  function closeStudio() {
    if (isDirty && !window.confirm("运镜草稿还没有应用，确定关闭吗？")) return;
    setIsClosing(true);
    window.setTimeout(onClose, reducedPreview ? 0 : 220);
  }

  function resetPlayback() {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setPlayhead(0);
    setPlaying(true);
  }

  function sendRuntimeControl(
    action: "pause" | "resume" | "replay" | "finish" | "set_playback_rate",
    rate?: 0.5 | 1 | 2,
  ) {
    if (!activeRuntimeRunIdRef.current) return;
    const requestId = `camera-control-${Date.now()}`;
    syncRevisionRef.current += 1;
    postToRuntime({
      type: "agentvn.live-preview.control",
      protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
      sessionId: syncSessionRef.current,
      revision: syncRevisionRef.current,
      requestId,
      runId: activeRuntimeRunIdRef.current,
      action,
      playbackRate: rate,
    });
  }

  function requestRuntimeFreezeFrame(): string | undefined {
    if (!iframeRef.current?.contentWindow || !activeRuntimeRunIdRef.current) return undefined;
    const requestId = `camera-freeze-${Date.now()}-${syncRunRef.current}`;
    syncRevisionRef.current += 1;
    postToRuntime({
      type: "agentvn.live-preview.freeze-frame.request",
      protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
      sessionId: syncSessionRef.current,
      revision: syncRevisionRef.current,
      requestId,
      runId: activeRuntimeRunIdRef.current,
      width: 480,
      height: 270,
    });
    return requestId;
  }

  function runtimeDockLimit(horizontal: boolean) {
    const rect = stageDeckRef.current?.getBoundingClientRect();
    if (horizontal) {
      return {
        minimum: 260,
        maximum: Math.max(260, Math.min(720, (rect?.width ?? window.innerWidth) * 0.48)),
      };
    }
    return {
      minimum: 180,
      maximum: Math.max(180, Math.min(520, (rect?.height ?? window.innerHeight) * 0.55)),
    };
  }

  function resizeRuntimeDock(event: ReactPointerEvent<HTMLDivElement>) {
    if (runtimeExpanded || runtimeMinimized) return;
    event.preventDefault();
    const horizontal = window.innerWidth >= runtimeDockBreakpoint;
    const pointerId = event.pointerId;
    const startPoint = horizontal ? event.clientX : event.clientY;
    const startSize = horizontal ? runtimeDockWidth : runtimeDockHeight;
    runtimeTransition.beginTransition();
    const update = (clientPoint: number) => {
      const { minimum, maximum } = runtimeDockLimit(horizontal);
      const next = clamp(startSize - (clientPoint - startPoint), minimum, maximum);
      if (horizontal) setRuntimeDockWidth(next);
      else setRuntimeDockHeight(next);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      runtimeTransition.finishTransition();
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) update(horizontal ? moveEvent.clientX : moveEvent.clientY);
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId === pointerId) cleanup();
    };
    event.currentTarget.setPointerCapture?.(pointerId);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  function resizeRuntimeDockWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const horizontal = window.innerWidth >= runtimeDockBreakpoint;
    const decrease = horizontal ? event.key === "ArrowRight" : event.key === "ArrowDown";
    const increase = horizontal ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    if (!decrease && !increase) return;
    event.preventDefault();
    const amount = event.shiftKey ? 40 : 12;
    const { minimum, maximum } = runtimeDockLimit(horizontal);
    runtimeTransition.beginTransition();
    if (horizontal) {
      setRuntimeDockWidth((current) => clamp(current + (increase ? amount : -amount), minimum, maximum));
    } else {
      setRuntimeDockHeight((current) => clamp(current + (increase ? amount : -amount), minimum, maximum));
    }
    runtimeTransition.finishTransition();
  }

  function toggleRuntimeExpanded() {
    runtimeTransition.animateLayoutChange(() => setRuntimeExpanded((value) => !value));
  }

  function minimizeRuntimePreview() {
    const shell = runtimeShellRef.current;
    runtimeTransition.beginTransition();
    if (!shell || reducedPreview) {
      setRuntimeMinimized(true);
      setRuntimeExpanded(false);
      runtimeTransition.completeWithoutReload();
      return;
    }
    const animation = shell.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "translate(18px, -12px) scale(0.82)" },
      ],
      { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    animation.onfinish = () => {
      setRuntimeMinimized(true);
      setRuntimeExpanded(false);
      runtimeTransition.completeWithoutReload();
    };
  }

  function restoreRuntimePreview() {
    runtimeTransition.beginTransition();
    setRuntimeMinimized(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const shell = runtimeShellRef.current;
        if (shell && !reducedPreview) {
          shell.animate(
            [
              { opacity: 0, transform: "translate(18px, -12px) scale(0.82)" },
              { opacity: 1, transform: "translate(0, 0) scale(1)" },
            ],
            { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
          );
        }
        runtimeTransition.finishTransition();
      });
    });
  }

  function updatePose(pose: CameraPoseV1, shotIndex = selectedShotIndex) {
    if (draft.motion.kind === "sequence") {
      const normalized = safePose(pose, advanced);
      const shots = draft.motion.shots.map((shot, index) => (
        index === shotIndex ? { ...shot, to: normalized } : shot
      ));
      const hasUnsafeShot = shots.some((shot) => !isCameraPoseSafe(shot.to));
      setDraft({
        ...draft,
        blocking: true,
        motion: {
          ...draft.motion,
          shots,
          ...(hasUnsafeShot ? { unsafe_overscan: true as const } : {}),
          ...(!hasUnsafeShot ? { unsafe_overscan: undefined } : {}),
        },
      });
      setPlayhead(shotEndProgress(shots, shotIndex));
    } else {
      setDraft(reframeCommand(pose, draft, advanced));
      setPlayhead(1);
    }
    setPlaying(false);
  }

  function selectKind(kind: CameraMotionKind) {
    if (draft.motion.kind === "sequence") {
      if (kind === "reframe" || kind === "sequence") return;
      if (!window.confirm("切换动作会删除当前连续镜头，确定继续吗？")) return;
    }
    const next = createDefaultCameraCommand(kind, currentPose);
    setDraft({
      ...next,
      blocking: kind === "reframe" || kind === "sequence" || kind === "reset",
    });
    setSelectedShotIndex(0);
    setAdvanced(false);
    setPlayhead(0);
    setPlaying(true);
  }

  function addSequenceShot() {
    if (draft.motion.kind === "reframe") {
      const first: CameraSequenceShotV1 = {
        to: { ...draft.motion.to },
        duration_ms: draft.motion.duration_ms,
        easing: draft.motion.easing,
      };
      const second: CameraSequenceShotV1 = {
        to: { ...draft.motion.to },
        duration_ms: CAMERA_DEFAULTS.reframeDurationMs,
        easing: CAMERA_DEFAULTS.cinematicEasing,
      };
      const next: StructuredCameraCommand = {
        type: "camera",
        blocking: true,
        motion: {
          schema_version: 1,
          kind: "sequence",
          shots: [first, second],
          ...(draft.motion.unsafe_overscan ? { unsafe_overscan: true as const } : {}),
        },
      };
      setDraft(next);
      setSelectedShotIndex(1);
      setPlayhead(1);
      setPlaying(false);
      return;
    }
    if (draft.motion.kind !== "sequence" || draft.motion.shots.length >= 4) return;
    const last = draft.motion.shots[draft.motion.shots.length - 1];
    const shots = [
      ...draft.motion.shots,
      {
        to: { ...last.to },
        duration_ms: CAMERA_DEFAULTS.reframeDurationMs,
        easing: CAMERA_DEFAULTS.cinematicEasing,
      },
    ];
    setDraft({ ...draft, blocking: true, motion: { ...draft.motion, shots } });
    setSelectedShotIndex(shots.length - 1);
    setPlayhead(1);
    setPlaying(false);
  }

  function selectSequenceShot(index: number) {
    if (!sequenceMotion) return;
    setSelectedShotIndex(index);
    setPlayhead(shotEndProgress(sequenceMotion.shots, index));
    setPlaying(false);
    sendRuntimeControl("pause");
  }

  function deleteSequenceShot(index: number) {
    if (!sequenceMotion) return;
    const shots = sequenceMotion.shots.filter((_, shotIndex) => shotIndex !== index);
    if (shots.length === 1) {
      const remaining = shots[0];
      setDraft({
        type: "camera",
        blocking: true,
        motion: {
          schema_version: 1,
          kind: "reframe",
          to: { ...remaining.to },
          duration_ms: remaining.duration_ms,
          easing: remaining.easing,
          ...(!isCameraPoseSafe(remaining.to) ? { unsafe_overscan: true as const } : {}),
        },
      });
      setSelectedShotIndex(0);
      setPlayhead(1);
      setPlaying(false);
      return;
    }
    const nextIndex = Math.min(index, shots.length - 1);
    const hasUnsafeShot = shots.some((shot) => !isCameraPoseSafe(shot.to));
    setDraft({
      ...draft,
      blocking: true,
      motion: {
        ...sequenceMotion,
        shots,
        ...(hasUnsafeShot ? { unsafe_overscan: true as const } : {}),
        ...(!hasUnsafeShot ? { unsafe_overscan: undefined } : {}),
      },
    });
    setSelectedShotIndex(nextIndex);
    setPlayhead(shotEndProgress(shots, nextIndex));
    setPlaying(false);
  }

  function reorderSequenceShot(from: number, to: number) {
    if (!sequenceMotion || from === to) return;
    const shots = [...sequenceMotion.shots];
    const [moved] = shots.splice(from, 1);
    shots.splice(to, 0, moved);
    setDraft({ ...draft, blocking: true, motion: { ...sequenceMotion, shots } });
    setSelectedShotIndex(to);
    setPlayhead(shotEndProgress(shots, to));
    setPlaying(false);
  }

  function sequenceDrop(event: DragEvent<HTMLDivElement>, to: number) {
    event.preventDefault();
    if (draggedShotIndex === undefined) return;
    reorderSequenceShot(draggedShotIndex, to);
    setDraggedShotIndex(undefined);
  }

  function applyPush(multiplier: number) {
    updatePose({ ...targetPose, zoom: targetPose.zoom * multiplier });
  }

  function applyPan(deltaX: number, deltaY: number) {
    const zoom = Math.max(targetPose.zoom, 1.25);
    updatePose({
      center_x: targetPose.center_x + deltaX * (0.18 / zoom),
      center_y: targetPose.center_y + deltaY * (0.18 / zoom),
      zoom,
    });
  }

  function focusCharacter(sprite: VisibleSprite, zoom: number) {
    const image = spritePreviewRefs.current.get(sprite.characterId);
    const world = stageRef.current?.querySelector<HTMLElement>(".camera-stage-world");
    if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && world) {
      const imageRect = image.getBoundingClientRect();
      const worldRect = world.getBoundingClientRect();
      const fitScale = Math.min(
        imageRect.width / image.naturalWidth,
        imageRect.height / image.naturalHeight,
      );
      const contentWidth = image.naturalWidth * fitScale;
      const contentHeight = image.naturalHeight * fitScale;
      const contentLeft = imageRect.left + (imageRect.width - contentWidth) / 2;
      const contentTop = imageRect.bottom - contentHeight;
      updatePose({
        center_x: clamp((contentLeft + contentWidth / 2 - worldRect.left) / worldRect.width, 0, 1),
        center_y: clamp((contentTop + contentHeight / 2 - worldRect.top) / worldRect.height, 0, 1),
        zoom,
      });
      return;
    }
    updatePose({
      center_x: spriteCenter(sprite.position),
      center_y: 0.52,
      zoom,
    });
  }

  function updateCustomEasing(index: CameraBezierPointIndex, value: number) {
    if (!Number.isFinite(value)) return;
    const next = [...customEasingPoints] as [number, number, number, number];
    next[index] = clamp(value, index === 0 || index === 2 ? 0 : -1, index === 0 || index === 2 ? 1 : 2);
    setDraft(commandWithEasing(
      draft,
      `cubic-bezier(${next.join(", ")})`,
      selectedShotIndex,
    ));
  }

  function updateDuration(durationMs: number) {
    const next = commandWithDuration(draft, durationMs, selectedShotIndex);
    setDraft(next);
    if (next.motion.kind === "sequence") {
      setPlayhead(shotEndProgress(next.motion.shots, selectedShotIndex));
      setPlaying(false);
    }
  }

  function stagePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    shotIndex = selectedShotIndex,
  ) {
    if (draft.motion.kind !== "reframe" && draft.motion.kind !== "sequence") return;
    const stage = stageRef.current;
    if (!stage) return;
    if (draft.motion.kind === "sequence" && shotIndex !== selectedShotIndex) {
      selectSequenceShot(shotIndex);
      return;
    }
    const rect = stage.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startPose = draft.motion.kind === "sequence"
      ? draft.motion.shots[shotIndex].to
      : draft.motion.to;
    const start = { x: event.clientX, y: event.clientY, pose: startPose };
    const handleMove = (move: PointerEvent) => {
      const dx = (move.clientX - start.x) / rect.width * canvasSpan;
      const dy = (move.clientY - start.y) / rect.height * canvasSpan;
      if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < 3) return;
      updatePose({
        ...start.pose,
        center_x: start.pose.center_x + dx,
        center_y: start.pose.center_y + dy,
      }, shotIndex);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  function frameResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    corner: FrameCorner,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (draft.motion.kind !== "reframe" && draft.motion.kind !== "sequence") return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const startPose = draft.motion.kind === "sequence"
      ? draft.motion.shots[selectedShotIndex].to
      : draft.motion.to;
    const startSize = 1 / startPose.zoom;
    const movesEast = corner.endsWith("east");
    const movesSouth = corner.startsWith("south");
    const anchorX = startPose.center_x + (movesEast ? -startSize / 2 : startSize / 2);
    const anchorY = startPose.center_y + (movesSouth ? -startSize / 2 : startSize / 2);
    const minimumZoom = advanced ? CAMERA_LIMITS.advancedZoomMin : CAMERA_LIMITS.normalZoomMin;
    const maximumZoom = advanced ? CAMERA_LIMITS.advancedZoomMax : CAMERA_LIMITS.normalZoomMax;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };

    const handleMove = (move: PointerEvent) => {
      if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < 3) return;
      const deltaX = (move.clientX - start.x) / rect.width * canvasSpan * (movesEast ? 1 : -1);
      const deltaY = (move.clientY - start.y) / rect.height * canvasSpan * (movesSouth ? 1 : -1);
      const nextSize = clamp(
        startSize + (deltaX + deltaY) / 2,
        1 / maximumZoom,
        1 / minimumZoom,
      );
      updatePose({
        center_x: anchorX + (movesEast ? nextSize / 2 : -nextSize / 2),
        center_y: anchorY + (movesSouth ? nextSize / 2 : -nextSize / 2),
        zoom: 1 / nextSize,
      });
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  function stageWheel(event: WheelEvent<HTMLDivElement>) {
    if (draft.motion.kind !== "reframe" && draft.motion.kind !== "sequence") return;
    event.preventDefault();
    updatePose({
      ...targetPose,
      zoom: targetPose.zoom * (event.deltaY > 0 ? 0.94 : 1.06),
    });
  }

  function frameKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (draft.motion.kind !== "reframe" && draft.motion.kind !== "sequence") return;
    const amount = event.shiftKey ? 0.025 : 0.006;
    if (event.key === "ArrowLeft") updatePose({ ...targetPose, center_x: targetPose.center_x - amount });
    else if (event.key === "ArrowRight") updatePose({ ...targetPose, center_x: targetPose.center_x + amount });
    else if (event.key === "ArrowUp") updatePose({ ...targetPose, center_y: targetPose.center_y - amount });
    else if (event.key === "ArrowDown") updatePose({ ...targetPose, center_y: targetPose.center_y + amount });
    else if (event.key === "+" || event.key === "=") updatePose({ ...targetPose, zoom: targetPose.zoom + 0.05 });
    else if (event.key === "-") updatePose({ ...targetPose, zoom: targetPose.zoom - 0.05 });
    else return;
    event.preventDefault();
  }

  function postToRuntime(message: Record<string, unknown>) {
    iframeRef.current?.contentWindow?.postMessage(message, runtimePreviewOrigin);
  }

  function previewStart(requestId: string): PreviewStartSpec {
    return {
      requestId,
      target: { sceneId, commandIndex },
      entryPath: selectedPath?.steps ?? [],
      mode: "play_target_event",
      playbackRate,
      reducedMotion: reducedPreview,
    };
  }

  function editorScriptWithDraft(): RuntimeScript {
    const editor = useEditorStore.getState();
    const settings = useProjectStore.getState().settings;
    const script = applyCharacterDialogStylesToScript(
      applyProjectRuntimeSettingsToScript(editor.exportScript() as RuntimeScript, settings),
      settings.characterDialogStyles,
    );
    const previewCommand = legacyComparisonCommand && runtimeComparison === "legacy"
      ? legacyComparisonCommand
      : draft;
    return draftScene(script, sceneId, commands, commandIndex, previewCommand, inserting);
  }

  async function initializeRuntimePreview() {
    if (!iframeRef.current?.contentWindow) return;
    setRuntimeStatus("connecting");
    setRuntimeMessage("正在连接真实 GameCLI…");
    try {
      if (pathCandidates.length > 1 && !selectedPath && !usingSceneDefault) {
        throw new Error("这个场景有多个进入路线，请先选择要预览的路线。");
      }
      const currentProject = useProjectStore.getState();
      const script = editorScriptWithDraft();
      const data = await createEditorLivePreviewData({
        script,
        gameId: currentProject.projectId,
        title: currentProject.title,
        author: currentProject.author,
        version: "0.1.0-camera-preview",
        language: "zh-CN",
        description: `${currentProject.title} 运镜预览`,
        includeGallery: false,
        includeMetadata: false,
        projectAssets: manifestAssetsFromProjectAssets(currentProject.assetManifest),
        projectAssetRefs: currentProject.assetManifest,
        uiSkin: currentProject.settings.runtimeUILayout,
        packageAppearance: currentProject.settings.packageAppearance,
        characterDialogStyles: currentProject.settings.characterDialogStyles,
      });
      const requestId = `camera-init-${Date.now()}`;
      const runId = `camera-run-${++syncRunRef.current}`;
      activeRuntimeRunIdRef.current = runId;
      syncRevisionRef.current += 1;
      postToRuntime({
        type: "agentvn.live-preview.init",
        protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
        sessionId: syncSessionRef.current,
        revision: syncRevisionRef.current,
        requestId,
        runId,
        manifest: data.manifest,
        script: data.script,
        uiSkin: data.uiSkin,
        assetUrls: liveAssetUrls(currentProject.assetManifest),
        start: previewStart(requestId),
        screen: "playing",
      });
      initializedRef.current = true;
    } catch (error) {
      reportFrontendError("editor.camera-preview", error, { operation: "initialize-runtime-preview" });
      setRuntimeStatus("error");
      setRuntimeMessage(error instanceof Error ? error.message : "真实预览连接失败。");
    }
  }

  useEffect(() => {
    if (!initializedRef.current) {
      if (selectedPath || usingSceneDefault) void initializeRuntimePreview();
      return;
    }
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      const requestId = `camera-patch-${Date.now()}`;
      const runId = `camera-run-${++syncRunRef.current}`;
      activeRuntimeRunIdRef.current = runId;
      syncRevisionRef.current += 1;
      const scene = editorScriptWithDraft().scenes.find((item) => item.scene_id === sceneId);
      postToRuntime({
        type: "agentvn.live-preview.patch",
        protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
        sessionId: syncSessionRef.current,
        revision: syncRevisionRef.current,
        requestId,
        runId,
        scenes: scene ? [scene as Scene] : undefined,
        start: previewStart(requestId),
      });
    }, 150);
    return () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [draft, legacyComparisonCommand, playbackRate, reducedPreview, runtimeComparison, selectedPath, selectedPathId, usingSceneDefault]);

  useEffect(() => {
    function handleRuntimeMessage(event: MessageEvent<LivePreviewRuntimeMessage>) {
      if (event.origin !== runtimePreviewOrigin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.protocolVersion !== LIVE_PREVIEW_PROTOCOL_VERSION) return;
      if (event.data.sessionId === "runtime-boot" && event.data.revision === 0) {
        if (runtimeTransition.phase === "ready") void initializeRuntimePreview();
        return;
      }
      if (event.data.sessionId !== syncSessionRef.current) return;
      if (event.data.type === "agentvn.live-preview.freeze-frame.result") {
        runtimeTransition.acceptFreezeFrame(event.data.requestId, event.data.image);
        return;
      }
      if (event.data.revision < syncRevisionRef.current) return;
      if (event.data.type === "agentvn.live-preview.error") {
        setRuntimeStatus("error");
        setRuntimeMessage(event.data.message);
      } else {
        setRuntimeStatus("ready");
        setRuntimeMessage("真实演出已同步");
        runtimeTransition.markReady();
      }
    }
    window.addEventListener("message", handleRuntimeMessage);
    return () => window.removeEventListener("message", handleRuntimeMessage);
  }, [draft, playbackRate, runtimeTransition.phase]);

  useEffect(() => {
    function handleGlobalKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeStudio();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        onApply(draft);
        return;
      }
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        if (!playing && draft.motion.kind === "sequence") {
          setPlayhead(0);
          setPlaying(true);
          sendRuntimeControl("replay");
        } else {
          setPlaying((value) => {
            sendRuntimeControl(value ? "pause" : "resume");
            return !value;
          });
        }
      }
      if (event.key.toLowerCase() === "r" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        resetPlayback();
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [draft, isDirty, playing, reducedPreview]);

  const authoredPoses = sequenceMotion
    ? [currentPose, ...sequenceMotion.shots.map((shot) => shot.to)]
    : [currentPose, targetPose];
  const canvasExtent = overscan
    ? authoredPoses.reduce((extent, pose) => {
        const left = pose.center_x - 0.5 / pose.zoom;
        const right = pose.center_x + 0.5 / pose.zoom;
        const top = pose.center_y - 0.5 / pose.zoom;
        const bottom = pose.center_y + 0.5 / pose.zoom;
        return Math.max(extent, -left, right - 1, -top, bottom - 1);
      }, 0)
    : 0;
  const canvasSpan = 1 + canvasExtent * 2;
  const frameStyle = (pose: CameraPoseV1) => ({
    "--frame-left": `${((pose.center_x - 0.5 / pose.zoom + canvasExtent) / canvasSpan) * 100}%`,
    "--frame-top": `${((pose.center_y - 0.5 / pose.zoom + canvasExtent) / canvasSpan) * 100}%`,
    "--frame-width": `${(1 / pose.zoom / canvasSpan) * 100}%`,
    "--frame-height": `${(1 / pose.zoom / canvasSpan) * 100}%`,
  }) as CSSProperties;
  const currentFrameStyle = frameStyle(currentPose);
  const targetFrameStyle = frameStyle(targetPose);
  const previewZoom = Math.max(0.0001, frame.pose.zoom * (1 + frame.impulse.zoom_delta));
  const previewPose = {
    center_x: frame.pose.center_x - frame.impulse.offset_x / Math.max(frame.pose.zoom, 0.0001),
    center_y: frame.pose.center_y - frame.impulse.offset_y / Math.max(frame.pose.zoom, 0.0001),
    zoom: previewZoom,
  };
  const previewFrameStyle = frameStyle(previewPose);
  const worldStyle = {
    "--world-left": `${(canvasExtent / canvasSpan) * 100}%`,
    "--world-top": `${(canvasExtent / canvasSpan) * 100}%`,
    "--world-size": `${(1 / canvasSpan) * 100}%`,
  } as CSSProperties;
  const mapCanvasPoint = (value: number) => ((value + canvasExtent) / canvasSpan) * 100;
  const centerMarkerStyle = (pose: CameraPoseV1) => ({
    "--center-left": `${mapCanvasPoint(pose.center_x)}%`,
    "--center-top": `${mapCanvasPoint(pose.center_y)}%`,
  }) as CSSProperties;

  const dialog = (
    <div className={`camera-studio-backdrop${isClosing ? " is-closing" : ""}`} role="presentation">
      <section
        ref={dialogRef}
        className="camera-studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-studio-title"
      >
        <header className="camera-studio-header">
          <div>
            <span className="camera-studio-kicker">运镜工作室</span>
            <h2 id="camera-studio-title">{motionName(draft.motion.kind)}</h2>
            <p>只移动剧情世界层，对白、选项和系统界面会保持固定。</p>
          </div>
          <button type="button" className="camera-studio-close" onClick={closeStudio} aria-label="关闭运镜工作室">
            <X size={18} />
          </button>
        </header>

        <div className="camera-studio-layout">
          <aside className="camera-studio-controls" aria-label="运镜参数">
            <section>
              <h3>进入路线</h3>
              {pathCandidates.length > 1 ? (
                <label className="camera-path-select">
                  选择继承机位的路线
                  <RichSelect
                    value={selectedPathId}
                    placeholder="请选择路线"
                    ariaLabel="选择继承机位的路线"
                    options={[
                      ...pathCandidates.map((candidate, index) => ({
                        value: candidate.id,
                        label: `路线 ${index + 1}：${candidate.label}`,
                      })),
                      { value: sceneDefaultPathId, label: "单场景默认机位" },
                    ]}
                    onChange={(pathId) => {
                      setSelectedPathId(pathId);
                      if (pathId) window.localStorage.setItem(pathStorageKey, pathId);
                    }}
                  />
                  <small>不同路线可能继承不同机位；路线失效时也可以明确改用单场景默认机位。</small>
                  <div className="camera-path-poses" aria-label="各路线继承机位">
                    {pathPoseSummaries.map((candidate, index) => (
                      <button
                        type="button"
                        key={candidate.id}
                        className={selectedPath?.id === candidate.id ? "is-active" : ""}
                        onClick={() => {
                          setSelectedPathId(candidate.id);
                          window.localStorage.setItem(pathStorageKey, candidate.id);
                        }}
                      >
                        <span>路线 {index + 1}</span>
                        <strong>
                          中心 {Math.round(candidate.pose.center_x * 100)}% / {Math.round(candidate.pose.center_y * 100)}%，
                          缩放 {candidate.pose.zoom.toFixed(2)}×
                        </strong>
                      </button>
                    ))}
                  </div>
                </label>
              ) : (
                <p className="camera-path-note">
                  {pathCandidates.length === 1 ? `当前路线：${pathCandidates[0].label}` : "当前使用单场景默认机位预览。"}
                </p>
              )}
            </section>
            <section>
              <h3>动作</h3>
              <div className="camera-kind-grid">
                {(["reframe", "reset", "shake", "impact"] as const).map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    className={draft.motion.kind === kind || (kind === "reframe" && draft.motion.kind === "sequence") ? "is-active" : ""}
                    onClick={() => selectKind(kind)}
                  >
                    {motionName(kind)}
                  </button>
                ))}
              </div>
            </section>

            {(reframeMotion || sequenceMotion) && (
              <>
                <section>
                  <h3>快速构图</h3>
                  <div className="camera-preset-grid">
                    <button type="button" onClick={() => applyPush(1.12)}>轻推</button>
                    <button type="button" onClick={() => applyPush(1.32)}>深推</button>
                    <button
                      type="button"
                      onClick={() => sequenceMotion ? updatePose(DEFAULT_CAMERA_POSE) : selectKind("reset")}
                    >
                      拉回全景
                    </button>
                    <button type="button" onClick={() => applyPan(-1, 0)}>向左平移</button>
                    <button type="button" onClick={() => applyPan(1, 0)}>向右平移</button>
                    <button type="button" onClick={() => applyPan(0, -1)}>向上平移</button>
                    <button type="button" onClick={() => applyPan(0, 1)}>向下平移</button>
                  </div>
                  {reframeMotion && (
                    <button
                      type="button"
                      className="camera-sequence-entry"
                      onClick={addSequenceShot}
                    >
                      <Plus size={15} />
                      添加连续镜头
                    </button>
                  )}
                </section>
                {sprites.length > 0 && (
                  <section>
                    <h3>角色聚焦</h3>
                    <div className="camera-focus-list">
                      {sprites.map((sprite) => (
                        <div key={sprite.characterId}>
                          <strong>{sprite.characterId}</strong>
                          <span>
                            <button type="button" onClick={() => focusCharacter(sprite, 1.1)}>环境</button>
                            <button type="button" onClick={() => focusCharacter(sprite, 1.25)}>中景</button>
                            <button type="button" onClick={() => focusCharacter(sprite, 1.5)}>近景</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <section className="camera-number-grid">
                  <label>
                    横向中心
                    <input type="number" min="0" max="1" step="0.01" value={targetPose.center_x} onChange={(event) => updatePose({ ...targetPose, center_x: Number(event.target.value) })} />
                  </label>
                  <label>
                    纵向中心
                    <input type="number" min="0" max="1" step="0.01" value={targetPose.center_y} onChange={(event) => updatePose({ ...targetPose, center_y: Number(event.target.value) })} />
                  </label>
                  <label>
                    缩放倍数
                    <input
                      type="number"
                      min={advanced ? 0.5 : 1}
                      max={advanced ? 4 : 2.5}
                      step="0.01"
                      value={targetPose.zoom}
                      onChange={(event) => updatePose({ ...targetPose, zoom: Number(event.target.value) })}
                    />
                  </label>
                </section>
              </>
            )}

            {impulseMotion && (
              <section className="camera-number-grid">
                <label>
                  强度
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={impulseMotion.intensity}
                    onChange={(event) => setDraft((current) => (
                      current.motion.kind === "shake" || current.motion.kind === "impact"
                        ? { ...current, motion: { ...current.motion, intensity: Number(event.target.value) } }
                        : current
                    ))}
                  />
                  <span>{Math.round(impulseMotion.intensity * 100)}%</span>
                </label>
                <label>
                  方向
                  <RichSelect
                    value={impulseMotion.direction}
                    ariaLabel="运镜方向"
                    options={impulseMotion.kind === "shake"
                      ? [
                          { value: "omni", label: "全向" },
                          { value: "horizontal", label: "横向" },
                          { value: "vertical", label: "纵向" },
                        ]
                      : [
                          { value: "omni", label: "全向" },
                          { value: "from_left", label: "来自左侧" },
                          { value: "from_right", label: "来自右侧" },
                          { value: "from_top", label: "来自上方" },
                          { value: "from_bottom", label: "来自下方" },
                        ]}
                    onChange={(direction) => setDraft((current) => {
                      if (current.motion.kind === "shake") {
                        return {
                          ...current,
                          motion: {
                            ...current.motion,
                            direction: direction as typeof current.motion.direction,
                          },
                        };
                      }
                      if (current.motion.kind === "impact") {
                        return {
                          ...current,
                          motion: {
                            ...current.motion,
                            direction: direction as typeof current.motion.direction,
                          },
                        };
                      }
                      return current;
                    })}
                  />
                </label>
              </section>
            )}

            <section className="camera-number-grid">
              <label>
                时长（毫秒）
                <input
                  type="number"
                  min="0"
                  max={draft.motion.kind === "reframe" || draft.motion.kind === "sequence" || draft.motion.kind === "reset" ? 10000 : 3000}
                  step="20"
                  value={poseDurationMs}
                  onChange={(event) => updateDuration(Number(event.target.value))}
                />
              </label>
              {(draft.motion.kind === "reframe" || draft.motion.kind === "sequence" || draft.motion.kind === "reset") && (
                <label>
                  缓动
                  <RichSelect
                    value={easingChoice}
                    ariaLabel="运镜缓动"
                    options={[
                      ...cameraEasingOptions,
                      { value: "custom", label: "自定义曲线" },
                    ]}
                    onChange={(easing) => {
                      if (easing === "custom") {
                        setDraft(commandWithEasing(
                          draft,
                          `cubic-bezier(${defaultCustomEasingPoints.join(", ")})`,
                          selectedShotIndex,
                        ));
                        return;
                      }
                      setDraft(commandWithEasing(
                        draft,
                        easing as VisualTransitionEasing,
                        selectedShotIndex,
                      ));
                    }}
                  />
                </label>
              )}
              {poseEasing && easingChoice === "custom" && (
                <div className="camera-easing-custom" aria-label="自定义缓动曲线">
                  {([
                    ["第一控制点横向", 0, 0, 1],
                    ["第一控制点纵向", 1, -1, 2],
                    ["第二控制点横向", 2, 0, 1],
                    ["第二控制点纵向", 3, -1, 2],
                  ] as const).map(([label, index, minimum, maximum]) => (
                    <label key={label}>
                      {label}
                      <input
                        type="number"
                        min={minimum}
                        max={maximum}
                        step="0.01"
                        value={customEasingPoints[index]}
                        onChange={(event) => updateCustomEasing(index, Number(event.target.value))}
                      />
                    </label>
                  ))}
                  <small>横向可填 0 到 1，纵向可填 -1 到 2。</small>
                </div>
              )}
              {sequenceMotion ? (
                <p className="camera-sequence-blocking-note">连续运镜会完整播放后再继续剧情。</p>
              ) : (
                <label className="camera-check-row">
                  <input type="checkbox" checked={draft.blocking} onChange={(event) => setDraft({ ...draft, blocking: event.target.checked })} />
                  等镜头结束再继续剧情
                </label>
              )}
              {(draft.motion.kind === "reframe" || draft.motion.kind === "sequence") && (
                <label className="camera-check-row">
                <input
                  type="checkbox"
                  checked={advanced}
                  onChange={(event) => {
                    setAdvanced(event.target.checked);
                    if (!event.target.checked) {
                      if (draft.motion.kind === "reframe") {
                        setDraft(reframeCommand(draft.motion.to, draft, false));
                      } else if (draft.motion.kind === "sequence") {
                        setDraft({
                          ...draft,
                          blocking: true,
                          motion: {
                            ...draft.motion,
                            shots: draft.motion.shots.map((shot) => ({
                              ...shot,
                              to: safePose(shot.to, false),
                            })),
                            unsafe_overscan: undefined,
                          },
                        });
                      }
                    }
                  }}
                />
                高级构图（允许露出舞台底色）
                </label>
              )}
            </section>
          </aside>

          <main
            className="camera-studio-stage-column"
            style={{
              "--camera-runtime-dock-width": `${runtimeDockWidth}px`,
              "--camera-runtime-dock-height": `${runtimeDockHeight}px`,
            } as CSSProperties}
          >
            <div
              ref={stageDeckRef}
              className={`camera-studio-stage-deck${runtimeExpanded ? " is-runtime-expanded" : ""}${runtimeMinimized ? " is-runtime-minimized" : ""}`}
            >
              <div className="camera-local-stage-pane">
                <div
                  ref={stageRef}
                  className={`camera-composition-stage${overscan ? " has-overscan" : ""}`}
                  onWheel={stageWheel}
                  aria-label="运镜构图舞台"
                >
              <div className="camera-stage-world" style={worldStyle}>
                {assetSource(backgroundAsset) ? <img src={assetSource(backgroundAsset)} alt="" className="camera-stage-background" /> : <div className="camera-stage-empty">当前没有背景图</div>}
                {sprites.map((sprite) => {
                  const asset = assets.find((item) => item.asset_id === sprite.spriteId);
                  return assetSource(asset) ? (
                    <img
                      key={sprite.characterId}
                      ref={(element) => {
                        if (element) spritePreviewRefs.current.set(sprite.characterId, element);
                        else spritePreviewRefs.current.delete(sprite.characterId);
                      }}
                      src={assetSource(asset)}
                      alt=""
                      data-camera-character-id={sprite.characterId}
                      className={`camera-stage-sprite is-${sprite.position}`}
                      style={{ "--sprite-scale": sprite.scale } as CSSProperties}
                    />
                  ) : null;
                })}
              </div>
              <div className="camera-stage-grid" aria-hidden="true" />
              <div className="camera-frame is-current" style={currentFrameStyle}>
                <span>{sequenceMotion ? "起点" : "当前机位"}</span>
              </div>
              <div className="camera-frame is-preview" style={previewFrameStyle} aria-hidden="true"><span>播放机位</span></div>
              {sequenceMotion ? (
                <>
                  {sequenceMotion.shots.map((shot, index) => {
                    const selected = index === selectedShotIndex;
                    const emphasized = index === playbackShotIndex;
                    return (
                      <div
                        key={`sequence-shot-${index}`}
                        className={`camera-frame is-target is-sequence-shot is-shot-${index + 1}${selected ? " is-selected" : ""}${emphasized ? " is-emphasized" : " is-muted"}`}
                        style={frameStyle(shot.to)}
                        tabIndex={0}
                        role="application"
                        aria-label={`镜头 ${index + 1}${selected ? "，当前选中，可拖动或用方向键调整" : "，点击选择"}`}
                        onPointerDown={(event) => stagePointerDown(event, index)}
                        onKeyDown={(event) => {
                          if (!selected && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            selectSequenceShot(index);
                            return;
                          }
                          if (selected) frameKeyboard(event);
                        }}
                      >
                        <span>镜头 {index + 1}</span>
                        {selected && !playing && ([
                          ["north-west", "左上角"],
                          ["north-east", "右上角"],
                          ["south-west", "左下角"],
                          ["south-east", "右下角"],
                        ] as const).map(([corner, label]) => (
                          <button
                            type="button"
                            key={corner}
                            className={`camera-frame-handle is-${corner}`}
                            aria-label={`拖动${label}调整镜头 ${index + 1} 取景框大小`}
                            onPointerDown={(event) => frameResizePointerDown(event, corner)}
                          />
                        ))}
                      </div>
                    );
                  })}
                  <svg className="camera-center-line is-sequence" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {sequenceMotion.shots.map((shot, index) => {
                      const from = index === 0 ? currentPose : sequenceMotion.shots[index - 1].to;
                      const emphasized = index === playbackShotIndex;
                      return (
                        <g
                          key={`sequence-guide-${index}`}
                          className={`camera-sequence-guide is-shot-${index + 1}${emphasized ? " is-emphasized" : " is-muted"}`}
                        >
                          <line
                            className="camera-center-line-underlay"
                            x1={mapCanvasPoint(from.center_x)}
                            y1={mapCanvasPoint(from.center_y)}
                            x2={mapCanvasPoint(shot.to.center_x)}
                            y2={mapCanvasPoint(shot.to.center_y)}
                          />
                          <line
                            className="camera-center-line-main"
                            x1={mapCanvasPoint(from.center_x)}
                            y1={mapCanvasPoint(from.center_y)}
                            x2={mapCanvasPoint(shot.to.center_x)}
                            y2={mapCanvasPoint(shot.to.center_y)}
                          />
                        </g>
                      );
                    })}
                  </svg>
                </>
              ) : (
                <>
                  <div
                    className="camera-frame is-target"
                    style={targetFrameStyle}
                    tabIndex={draft.motion.kind === "reframe" ? 0 : -1}
                    role="application"
                    aria-label="目标机位，可拖动或用方向键调整"
                    onPointerDown={stagePointerDown}
                    onKeyDown={frameKeyboard}
                  >
                    <span>目标机位</span>
                    {([
                      ["north-west", "左上角"],
                      ["north-east", "右上角"],
                      ["south-west", "左下角"],
                      ["south-east", "右下角"],
                    ] as const).map(([corner, label]) => (
                      <button
                        type="button"
                        key={corner}
                        className={`camera-frame-handle is-${corner}`}
                        aria-label={`拖动${label}调整取景框大小`}
                        onPointerDown={(event) => frameResizePointerDown(event, corner)}
                      />
                    ))}
                  </div>
                  <svg className="camera-center-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <line
                      className="camera-center-line-underlay"
                      x1={mapCanvasPoint(currentPose.center_x)}
                      y1={mapCanvasPoint(currentPose.center_y)}
                      x2={mapCanvasPoint(targetPose.center_x)}
                      y2={mapCanvasPoint(targetPose.center_y)}
                    />
                    <line
                      className="camera-center-line-main"
                      x1={mapCanvasPoint(currentPose.center_x)}
                      y1={mapCanvasPoint(currentPose.center_y)}
                      x2={mapCanvasPoint(targetPose.center_x)}
                      y2={mapCanvasPoint(targetPose.center_y)}
                    />
                  </svg>
                </>
              )}
              <div
                className="camera-center-marker is-current"
                style={centerMarkerStyle(currentPose)}
                aria-hidden="true"
              />
              {sequenceMotion ? sequenceMotion.shots.map((shot, index) => (
                <div
                  key={`sequence-marker-${index}`}
                  className={`camera-center-marker is-target is-sequence-shot is-shot-${index + 1}${index === playbackShotIndex ? " is-emphasized" : " is-muted"}`}
                  style={centerMarkerStyle(shot.to)}
                  aria-hidden="true"
                />
              )) : (
                <div
                  className="camera-center-marker is-target"
                  style={centerMarkerStyle(targetPose)}
                  aria-hidden="true"
                />
              )}
              {sequenceMotion && (
                <section className="camera-shot-manager" aria-label="连续镜头管理">
                  <header>
                    <strong>连续镜头</strong>
                    <span>{sequenceMotion.shots.length} / 4</span>
                  </header>
                  <div className="camera-shot-list">
                    {sequenceMotion.shots.map((shot, index) => (
                      <div
                        key={`shot-card-${index}`}
                        className={`camera-shot-card is-shot-${index + 1}${index === selectedShotIndex ? " is-active" : ""}`}
                        draggable
                        onDragStart={() => setDraggedShotIndex(index)}
                        onDragEnd={() => setDraggedShotIndex(undefined)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => sequenceDrop(event, index)}
                      >
                        <button
                          type="button"
                          className="camera-shot-select"
                          onClick={() => selectSequenceShot(index)}
                          onKeyDown={(event) => {
                            if (!event.altKey) return;
                            if (event.key === "ArrowLeft" && index > 0) {
                              event.preventDefault();
                              reorderSequenceShot(index, index - 1);
                            } else if (event.key === "ArrowRight" && index < sequenceMotion.shots.length - 1) {
                              event.preventDefault();
                              reorderSequenceShot(index, index + 1);
                            }
                          }}
                          aria-pressed={index === selectedShotIndex}
                          aria-label={`选择镜头 ${index + 1}，时长 ${shot.duration_ms} 毫秒；按 Alt 加左右方向键排序`}
                        >
                          <GripVertical size={13} aria-hidden="true" />
                          <span>镜头 {index + 1}</span>
                          <small>{(shot.duration_ms / 1000).toFixed(2)}s</small>
                        </button>
                        <button
                          type="button"
                          className="camera-shot-delete"
                          onClick={() => deleteSequenceShot(index)}
                          aria-label={`删除镜头 ${index + 1}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="camera-shot-add"
                      onClick={addSequenceShot}
                      disabled={sequenceMotion.shots.length >= 4}
                      title={sequenceMotion.shots.length >= 4 ? "连续运镜最多四个目标镜头" : "添加目标镜头"}
                    >
                      <Plus size={14} />
                      {sequenceMotion.shots.length >= 4 ? "已达上限" : "添加"}
                    </button>
                  </div>
                  {identicalShotIndices.includes(selectedShotIndex) && (
                    <p><AlertTriangle size={13} /> 这一段不会移动，只会等待。</p>
                  )}
                </section>
              )}
              {overscan && (
                <div className="camera-overscan-label">
                  <AlertTriangle size={15} /> 框外区域会显示舞台主题底色
                </div>
              )}
                </div>
                {runtimeMinimized && (
                  <button
                    ref={runtimeRestoreButtonRef}
                    type="button"
                    className="camera-runtime-restore"
                    onClick={restoreRuntimePreview}
                  >
                    <MonitorPlay size={15} /> 真实预览
                  </button>
                )}
              </div>

              {!runtimeMinimized && !runtimeExpanded && (
                <div
                  className="camera-runtime-divider"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整真实预览大小"
                  aria-orientation={window.innerWidth >= runtimeDockBreakpoint ? "vertical" : "horizontal"}
                  aria-valuemin={window.innerWidth >= runtimeDockBreakpoint ? 260 : 180}
                  aria-valuemax={window.innerWidth >= runtimeDockBreakpoint ? 720 : 520}
                  aria-valuenow={Math.round(window.innerWidth >= runtimeDockBreakpoint ? runtimeDockWidth : runtimeDockHeight)}
                  onPointerDown={resizeRuntimeDock}
                  onKeyDown={resizeRuntimeDockWithKeyboard}
                >
                  <GripVertical size={14} aria-hidden="true" />
                </div>
              )}

              {!runtimeMinimized && (
                <aside
                  ref={runtimeShellRef}
                  className={`camera-runtime-pip is-${runtimeStatus}${runtimeExpanded ? " is-expanded" : ""} is-transition-${runtimeTransition.phase}`}
                  aria-label="真实 GameCLI 预览"
                >
                  <header>
                    <span><Maximize2 size={14} /> 真实 GameCLI</span>
                    <div>
                      <button type="button" onClick={minimizeRuntimePreview} aria-label="最小化真实 GameCLI 预览">
                        <Minimize2 size={13} /> 最小化
                      </button>
                      <button
                        type="button"
                        onClick={toggleRuntimeExpanded}
                        aria-label={runtimeExpanded ? "还原真实 GameCLI 预览" : "放大真实 GameCLI 预览"}
                      >
                        {runtimeExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                        {runtimeExpanded ? "还原" : "放大"}
                      </button>
                      <button type="button" onClick={runtimeTransition.forceReload}><RefreshCw size={13} /> 重新连接</button>
                    </div>
                  </header>
                  {legacyComparisonCommand && (
                    <div className="camera-runtime-comparison" role="group" aria-label="转换前新旧效果对比">
                      <span>转换前对比</span>
                      <button
                        type="button"
                        className={runtimeComparison === "structured" ? "is-active" : ""}
                        aria-pressed={runtimeComparison === "structured"}
                        onClick={() => setRuntimeComparison("structured")}
                      >
                        新版运镜
                      </button>
                      <button
                        type="button"
                        className={runtimeComparison === "legacy" ? "is-active" : ""}
                        aria-pressed={runtimeComparison === "legacy"}
                        onClick={() => setRuntimeComparison("legacy")}
                      >
                        旧版整屏效果
                      </button>
                    </div>
                  )}
                  <div className="camera-runtime-frame">
                    <iframe
                      ref={iframeRef}
                      title="运镜真实演出预览"
                      src={runtimePreviewUrl}
                      onLoad={() => {
                        initializedRef.current = false;
                        if (runtimeTransition.phase === "ready") void initializeRuntimePreview();
                      }}
                    />
                    <RuntimePreviewMask
                      visible={runtimeTransition.maskVisible}
                      snapshot={runtimeTransition.snapshot}
                      phase={runtimeTransition.phase}
                    />
                  </div>
                  <p>{runtimeStatus === "error" ? <Unplug size={14} /> : null}{runtimeMessage}</p>
                </aside>
              )}
            </div>

            <div className="camera-playback-bar">
              <button
                type="button"
                onClick={() => {
                  if (!playing && sequenceMotion) {
                    setPlayhead(0);
                    setPlaying(true);
                    sendRuntimeControl("replay");
                    return;
                  }
                  setPlaying((value) => {
                    sendRuntimeControl(value ? "pause" : "resume");
                    return !value;
                  });
                }}
                aria-label={playing ? "暂停运镜预览" : "播放运镜预览"}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button type="button" onClick={() => { resetPlayback(); sendRuntimeControl("replay"); }} aria-label="重播运镜"><RotateCcw size={16} /></button>
              <label>
                播放位置
                <span className={`camera-playback-track${sequenceMotion ? " is-sequence" : ""}`}>
                  {sequenceMotion && (
                    <span className="camera-playback-segments" aria-hidden="true">
                      {sequenceMotion.shots.map((shot, index) => {
                        const total = cameraSequenceDuration(sequenceMotion.shots);
                        const basis = total > 0 ? shot.duration_ms / total : 1 / sequenceMotion.shots.length;
                        return (
                          <i
                            key={`playback-segment-${index}`}
                            className={`is-shot-${index + 1}`}
                            style={{ flexBasis: `${basis * 100}%` }}
                          />
                        );
                      })}
                    </span>
                  )}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={playhead}
                    onChange={(event) => { setPlaying(false); setPlayhead(Number(event.target.value)); }}
                    onPointerUp={() => sendRuntimeControl("replay")}
                    onKeyUp={() => sendRuntimeControl("replay")}
                  />
                </span>
              </label>
              <div className="camera-speed-group" aria-label="预览速度">
                {([0.5, 1, 2] as const).map((rate) => (
                  <button
                    type="button"
                    key={rate}
                    className={playbackRate === rate ? "is-active" : ""}
                    onClick={() => {
                      setPlaybackRate(rate);
                      sendRuntimeControl("set_playback_rate", rate);
                    }}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
              <label className="camera-check-row">
                <input type="checkbox" checked={reducedPreview} onChange={(event) => setReducedPreview(event.target.checked)} />
                低动态演出
              </label>
            </div>

            {sourceDensity !== undefined && sourceDensity < 1 && (
              <p className={`camera-density-warning${sourceDensity < 0.67 ? " is-severe" : ""}`}>
                <AlertTriangle size={15} />
                {sourceDensity < 0.67 ? "这个构图会明显放大素材，画面可能模糊。" : "这个构图会放大素材，建议检查清晰度。"}
              </p>
            )}

          </main>
        </div>

        <footer className="camera-studio-footer">
          <button type="button" className="camera-studio-cancel" onClick={closeStudio}>取消</button>
          <button type="button" className="camera-studio-apply" onClick={() => onApply(draft)}>应用运镜</button>
        </footer>
        <p className="sr-only" aria-live="polite">{announceText}</p>
      </section>
    </div>
  );

  return createPortal(dialog, document.body);
}
