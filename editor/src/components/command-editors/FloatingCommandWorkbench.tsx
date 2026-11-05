import {
  BookOpenText,
  Clapperboard,
  EyeOff,
  GitBranch,
  Hourglass,
  Image,
  Maximize2,
  MessageSquareText,
  Minus,
  Repeat2,
  RotateCcw,
  MonitorPlay,
  Move3d,
  Music2,
  ScanSearch,
  Sparkles,
  Volume2,
  WandSparkles,
  Images,
  ListPlus,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { BgmAction, GameCommand, GameCommandType } from "../../types/commands";
import type { CharacterSpriteAnimationConfig } from "../../../../shared/animation/characterAnimation";
import { compileCharacterAnimation, defaultCharacterAnimationConfig } from "../../../../shared/animation/characterAnimation";
import { DEFAULT_BGM_FADE_MS } from "../../../../shared/cartridge/bgmTransition";
import { sanitizeSpriteOffsetX, sanitizeSpriteOffsetY } from "../../../../shared/cartridge/spritePlacement";
import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale, spriteScalePercent } from "../../../../shared/cartridge/spriteScale";
import { commandLabels, defaultCommand } from "../../utils/commandTools";
import { characterIdFromSpriteTarget, collectCharacterIdsFromNodes, spriteTargetForCharacter } from "../../utils/characterReferences";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { applySpritePlacementToNodes, type SpritePlacementScope } from "../../utils/spritePlacementApply";
import { CharacterAnimationControls } from "./CharacterAnimationControls";
import { SpritePlacementStudioDialog } from "./SpritePlacementStudioDialog";
import { resolveCharacterSpriteLayout } from "../../utils/spritePlacementApply";
import { AssetPicker } from "../common/AssetPicker";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { RichSelect } from "../common/RichSelect";
import { inspectEditorAnimationAsset } from "../../animation/animationAsset";
import type { AssetRef } from "../../types/assets";

interface WorkbenchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WorkbenchGroup {
  id: string;
  title: string;
  types: GameCommandType[];
}

interface InsertPopoverPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  placement: "top" | "bottom";
}

const storageKey = "agentvn.commandWorkbenchRect.layoutV3";
const obsoleteStorageKeys = [
  "agentvn.commandWorkbenchRect",
  "agentvn.commandWorkbenchRect.layoutV2",
  "agentvn.commandWorkbenchRect.v2",
  "agentvn.commandWorkbenchRect.v3",
  "agentvn.commandWorkbenchRect.v4",
];
const workbenchTopOffset = 176;
const canvasInsetX = 16;
const canvasInsetY = 16;
const defaultOffsetX = 48;
const defaultOffsetY = 28;
const preferredWidth = 840;
const preferredHeight = 960;
const minWorkbenchWidth = 320;
const minWorkbenchHeight = 260;
const switchDurationMs = 220;
const detailMorphMs = 360;
const detailMorphSettleMs = 160;
const workbenchGroups: WorkbenchGroup[] = [
  {
    id: "narrative",
    title: "文本叙事",
    types: ["dialog", "narration", "hide_dialog"],
  },
  {
    id: "visuals",
    title: "画面角色",
    types: ["background", "show_image", "video", "sprite"],
  },
  {
    id: "branching",
    title: "分支状态",
    types: ["choice", "state_update", "conditional_jump", "jump"],
  },
  {
    id: "audio",
    title: "音频节奏",
    types: ["bgm", "sfx", "wait"],
  },
  {
    id: "gallery",
    title: "画廊",
    types: ["gallery_anchor"],
  },
  {
    id: "performance",
    title: "演出镜头",
    types: ["animation", "camera"],
  },
];

function commandIcon(type: GameCommandType) {
  switch (type) {
    case "dialog":
      return MessageSquareText;
    case "narration":
      return BookOpenText;
    case "hide_dialog":
      return EyeOff;
    case "background":
      return Image;
    case "show_image":
      return ScanSearch;
    case "video":
      return Clapperboard;
    case "sprite":
      return MonitorPlay;
    case "choice":
      return GitBranch;
    case "state_update":
      return WandSparkles;
    case "conditional_jump":
      return GitBranch;
    case "jump":
      return Repeat2;
    case "animation":
      return Maximize2;
    case "bgm":
      return Music2;
    case "sfx":
      return Volume2;
    case "camera":
      return Clapperboard;
    case "wait":
      return Hourglass;
    case "gallery_anchor":
      return Images;
    case "rollback":
      return RotateCcw;
  }
}

function loadRect(): WorkbenchRect {
  const defaultRect = defaultWorkbenchRect();
  try {
    obsoleteStorageKeys.forEach((key) => window.localStorage.removeItem(key));
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return defaultRect;
    const parsed = { ...defaultRect, ...JSON.parse(saved) } as WorkbenchRect;
    return clampRect(parsed);
  } catch (error) {
    reportFrontendError("editor.command-workbench", error, {
      operation: "restore-layout",
      key: storageKey,
    });
    return defaultRect;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getCanvasBounds(): DOMRect {
  const workspace = document.querySelector<HTMLElement>(".editor-workspace");
  const flowSurface = document.querySelector<HTMLElement>(".flow-surface");
  const rect = (flowSurface ?? workspace)?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    if (right > left && bottom > top) return new DOMRect(left, top, right - left, bottom - top);
  }
  return new DOMRect(12, workbenchTopOffset, Math.max(460, window.innerWidth - 24), Math.max(420, window.innerHeight - workbenchTopOffset - 12));
}

function getWorkbenchBounds(): { left: number; top: number; width: number; height: number } {
  const canvas = getCanvasBounds();
  const width = Math.max(280, canvas.width - canvasInsetX * 2);
  const height = Math.max(260, canvas.height - canvasInsetY * 2);
  return {
    left: canvas.left + canvasInsetX,
    top: canvas.top + canvasInsetY,
    width,
    height,
  };
}

function defaultWorkbenchRect(): WorkbenchRect {
  const bounds = getWorkbenchBounds();
  const minWidth = Math.min(minWorkbenchWidth, bounds.width);
  const minHeight = Math.min(minWorkbenchHeight, bounds.height);
  return clampRect({
    x: bounds.left + Math.min(defaultOffsetX, Math.max(0, bounds.width - minWidth)),
    y: bounds.top + Math.min(defaultOffsetY, Math.max(0, bounds.height - minHeight)),
    width: clamp(preferredWidth, minWidth, bounds.width),
    height: clamp(preferredHeight, minHeight, bounds.height),
  });
}

function clampRect(rect: WorkbenchRect): WorkbenchRect {
  const bounds = getWorkbenchBounds();
  const minWidth = Math.min(minWorkbenchWidth, bounds.width);
  const minHeight = Math.min(minWorkbenchHeight, bounds.height);
  const width = clamp(rect.width, minWidth, bounds.width);
  const height = clamp(rect.height, minHeight, bounds.height);
  const maxX = bounds.left + bounds.width - width;
  const maxY = bounds.top + bounds.height - height;
  return {
    width,
    height,
    x: clamp(rect.x, bounds.left, maxX),
    y: clamp(rect.y, bounds.top, maxY),
  };
}

function quickPanelTitle(type: GameCommandType): string {
  return commandLabels[type];
}

export function FloatingCommandWorkbench({
  onAdd,
  onInsert,
  sceneId = "",
  commands = [],
  onOpenCameraStudio,
  onClose,
  onMinimize,
  isClosing = false,
  requestedCommand,
}: {
  onAdd: (command: GameCommand) => void;
  onInsert?: (command: GameCommand, afterIndex: number) => void;
  sceneId?: string;
  commands?: GameCommand[];
  onOpenCameraStudio?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
  isClosing?: boolean;
  requestedCommand?: { sceneId: string; type: GameCommandType; characterId?: string; nonce: number };
}) {
  const nodes = useEditorStore((state) => state.nodes);
  const setNodes = useEditorStore((state) => state.setNodes);
  const setNotice = useEditorStore((state) => state.setNotice);
  const characterSpriteLayouts = useProjectStore((state) => state.settings.characterSpriteLayouts);
  const characterDisplayNames = useProjectStore((state) => state.settings.characterDisplayNames);
  const characterIds = useMemo(() => collectCharacterIdsFromNodes(nodes), [nodes]);
  const [rect, setRect] = useState(loadRect);
  const initialType = requestedCommand?.sceneId === sceneId ? requestedCommand.type : "bgm";
  const [commandType, setCommandType] = useState<GameCommandType>(initialType);
  const [displayType, setDisplayType] = useState<GameCommandType>(initialType);
  const [transitionPhase, setTransitionPhase] = useState<"idle" | "leaving" | "entering">("entering");
  const [detailMorphPhase, setDetailMorphPhase] = useState<"idle" | "morphing" | "settled">("idle");
  const [pressedType, setPressedType] = useState<GameCommandType | null>(null);
  const [pulseType, setPulseType] = useState<GameCommandType | null>(null);
  const [closeRequested, setCloseRequested] = useState(false);
  const [bgmId, setBgmId] = useState("");
  const [bgmAction, setBgmAction] = useState<BgmAction>("play");
  const [bgmFadeMs, setBgmFadeMs] = useState(DEFAULT_BGM_FADE_MS);
  const [showImageId, setShowImageId] = useState("");
  const [showImageFit, setShowImageFit] = useState<"contain" | "cover" | "stretch">("contain");
  const [spriteCharacterId, setSpriteCharacterId] = useState(
    requestedCommand?.sceneId === sceneId ? requestedCommand.characterId || "alice" : "alice",
  );
  const [spriteAssetId, setSpriteAssetId] = useState("");
  const [spritePosition, setSpritePosition] = useState("center");
  const [spriteOffsetX, setSpriteOffsetX] = useState(0);
  const [spriteOffsetY, setSpriteOffsetY] = useState(0);
  const [spriteVisible, setSpriteVisible] = useState(true);
  const [spriteScale, setSpriteScale] = useState<number | null>(null);
  const [spritePlacementOpen, setSpritePlacementOpen] = useState(false);
  const [spriteAnimationConfig, setSpriteAnimationConfig] = useState<CharacterSpriteAnimationConfig>(() => defaultCharacterAnimationConfig(true));
  const [animationId, setAnimationId] = useState("");
  const [animationAssetPending, setAnimationAssetPending] = useState(false);
  const [animationAssetError, setAnimationAssetError] = useState<string>();
  const animationSelectionGeneration = useRef(0);
  useEffect(() => () => { ++animationSelectionGeneration.current; }, []);
  async function selectAnimationAsset(id: string, asset?: AssetRef) {
    const owner = ++animationSelectionGeneration.current;
    setAnimationAssetError(undefined);
    setAnimationAssetPending(false);
    if (!id) { setAnimationId(""); return; }
    if (!asset) { setAnimationAssetError("找不到所选动画素材。"); return; }
    setAnimationAssetPending(true);
    try {
      await inspectEditorAnimationAsset(asset);
      if (owner === animationSelectionGeneration.current) setAnimationId(id);
    } catch (error) {
      if (owner === animationSelectionGeneration.current)
        setAnimationAssetError(error instanceof Error ? error.message : String(error));
    } finally {
      if (owner === animationSelectionGeneration.current) setAnimationAssetPending(false);
    }
  }
  const [animationTarget, setAnimationTarget] = useState("sprite:alice");
  const [animationConfig, setAnimationConfig] = useState<CharacterSpriteAnimationConfig>(() => ({ ...defaultCharacterAnimationConfig(true), kind: "tween" }));
  const [insertPopoverOpen, setInsertPopoverOpen] = useState(false);
  const [insertAfterInput, setInsertAfterInput] = useState("");
  const [insertError, setInsertError] = useState("");
  const [insertPopoverPosition, setInsertPopoverPosition] = useState<InsertPopoverPosition>({
    top: 0,
    left: 0,
    width: 280,
    placement: "bottom",
  });
  const transitionTimerRef = useRef<number | undefined>(undefined);
  const pressTimerRef = useRef<number | undefined>(undefined);
  const pulseTimerRef = useRef<number | undefined>(undefined);
  const detailCardRef = useRef<HTMLElement>(null);
  const previousDetailRectRef = useRef<DOMRect | null>(null);
  const detailMorphRef = useRef<Animation | null>(null);
  const detailMorphSettleTimerRef = useRef<number | null>(null);
  const insertTriggerRef = useRef<HTMLButtonElement | null>(null);
  const insertPopoverRef = useRef<HTMLElement | null>(null);
  const insertInputRef = useRef<HTMLInputElement | null>(null);
  const prefersReducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(rect));
  }, [rect]);

  useEffect(() => {
    const layout = resolveCharacterSpriteLayout(spriteCharacterId, {
      characterDisplayNames,
      characterSpriteLayouts,
    });
    if (layout) {
      setSpritePosition(layout.position || "center");
      setSpriteOffsetX(layout.offset_x);
      setSpriteOffsetY(layout.offset_y);
      setSpriteScale(layout.scale);
      return;
    }
    setSpritePosition("center");
    setSpriteOffsetX(0);
    setSpriteOffsetY(0);
    setSpriteScale(null);
  }, [characterDisplayNames, characterSpriteLayouts, spriteCharacterId]);

  function updateInsertPopoverPosition() {
    const trigger = insertTriggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const viewportGap = 12;
    const gap = 8;
    const width = Math.min(320, Math.max(260, window.innerWidth - viewportGap * 2));
    const belowSpace = window.innerHeight - triggerRect.bottom - viewportGap;
    const aboveSpace = triggerRect.top - viewportGap;
    const placement: InsertPopoverPosition["placement"] = belowSpace < 220 && aboveSpace > belowSpace ? "top" : "bottom";
    const top = placement === "bottom" ? Math.min(window.innerHeight - viewportGap - 1, triggerRect.bottom + gap) : undefined;
    const bottom = placement === "top" ? Math.max(viewportGap, window.innerHeight - triggerRect.top + gap) : undefined;
    const left = Math.min(
      Math.max(viewportGap, triggerRect.right - width),
      Math.max(viewportGap, window.innerWidth - width - viewportGap),
    );
    setInsertPopoverPosition({ top, bottom, left, width, placement });
  }

  function closeInsertPopover() {
    setInsertPopoverOpen(false);
    setInsertAfterInput("");
    setInsertError("");
  }

  useEffect(() => {
    const handleResize = () => setRect((current) => clampRect(current));
    handleResize();
    window.addEventListener("resize", handleResize);
    const workspace = document.querySelector<HTMLElement>(".editor-workspace");
    const flowSurface = document.querySelector<HTMLElement>(".flow-surface");
    const boundsTarget = flowSurface ?? workspace;
    const observer = boundsTarget ? new ResizeObserver(handleResize) : undefined;
    if (boundsTarget) observer?.observe(boundsTarget);
    return () => {
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (!insertPopoverOpen) return;
    updateInsertPopoverPosition();
  }, [insertPopoverOpen, commands.length]);

  useEffect(() => {
    if (!insertPopoverOpen) return;
    const focusTimer = window.requestAnimationFrame(() => insertInputRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (insertTriggerRef.current?.contains(target) || insertPopoverRef.current?.contains(target)) return;
      closeInsertPopover();
    };
    const handleViewportChange = () => updateInsertPopoverPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [insertPopoverOpen]);

  useEffect(() => {
    if (commands.length === 0 || commandType === "camera") closeInsertPopover();
  }, [commands.length, commandType]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
      if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
      if (detailMorphSettleTimerRef.current !== null) window.clearTimeout(detailMorphSettleTimerRef.current);
      detailMorphRef.current?.cancel();
    };
  }, []);

  function clearDetailMorphSettleTimer() {
    if (detailMorphSettleTimerRef.current !== null) {
      window.clearTimeout(detailMorphSettleTimerRef.current);
      detailMorphSettleTimerRef.current = null;
    }
  }

  function captureDetailRect() {
    const node = detailCardRef.current;
    previousDetailRectRef.current = node ? node.getBoundingClientRect() : null;
  }

  useEffect(() => {
    if (commandType === displayType) {
      setTransitionPhase("idle");
      return;
    }
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    if (prefersReducedMotion) {
      setDisplayType(commandType);
      setTransitionPhase("idle");
      return;
    }
    setTransitionPhase("leaving");
    transitionTimerRef.current = window.setTimeout(() => {
      setDisplayType(commandType);
      setTransitionPhase("entering");
      transitionTimerRef.current = window.setTimeout(() => {
        setTransitionPhase("idle");
      }, switchDurationMs);
    }, 160);
  }, [commandType, displayType, prefersReducedMotion]);

  useLayoutEffect(() => {
    const previousRect = previousDetailRectRef.current;
    const node = detailCardRef.current;
    if (!previousRect || !node || transitionPhase !== "entering" || prefersReducedMotion) return;
    previousDetailRectRef.current = null;

    const nextRect = node.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    const scaleX = previousRect.width / Math.max(nextRect.width, 1);
    const scaleY = previousRect.height / Math.max(nextRect.height, 1);
    const moved = Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1 || Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;
    if (!moved) return;

    clearDetailMorphSettleTimer();
    detailMorphRef.current?.cancel();
    setDetailMorphPhase("morphing");
    const animation = node.animate(
      [
        {
          transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
          opacity: 0.96,
        },
        {
          transform: "translate(0, 0) scale(1, 1)",
          opacity: 1,
        },
      ],
      {
        duration: detailMorphMs,
        easing: "cubic-bezier(0.18, 0.9, 0.18, 1)",
        fill: "both",
      }
    );
    detailMorphRef.current = animation;
    let cleaned = false;
    const cleanupDetailMorphAnimation = () => {
      if (cleaned) return;
      cleaned = true;
      animation.oncancel = null;
      animation.cancel();
      node.style.transform = "";
      node.style.opacity = "";
      node.style.filter = "";
      if (detailMorphRef.current === animation) detailMorphRef.current = null;
    };
    animation.onfinish = () => {
      setDetailMorphPhase("settled");
      detailMorphSettleTimerRef.current = window.setTimeout(() => {
        setDetailMorphPhase("idle");
        detailMorphSettleTimerRef.current = null;
      }, detailMorphSettleMs);
      cleanupDetailMorphAnimation();
    };
    animation.oncancel = () => {
      clearDetailMorphSettleTimer();
      setDetailMorphPhase("idle");
      cleanupDetailMorphAnimation();
    };
  }, [displayType, transitionPhase, prefersReducedMotion]);

  function startMove(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = rect;
    const onMove = (moveEvent: PointerEvent) => {
      setRect(clampRect({ ...start, x: start.x + moveEvent.clientX - startX, y: start.y + moveEvent.clientY - startY }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = rect;
    const onMove = (moveEvent: PointerEvent) => {
      setRect(
        clampRect({
          ...start,
          width: start.width + moveEvent.clientX - startX,
          height: start.height + moveEvent.clientY - startY,
        })
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function buildCommand(): GameCommand {
    if (commandType === "bgm") {
      return { type: "bgm", bgm_id: bgmId || null, action: bgmAction, volume: 0.8, fade_ms: bgmFadeMs };
    }
    if (commandType === "show_image") {
      return {
        type: "show_image",
        image_id: showImageId.trim(),
        image_fit: showImageFit,
        image_display_name: showImageId.trim() || undefined,
        backdrop_opacity: 0.62,
        backdrop_blur_px: 12,
      };
    }
    if (commandType === "sprite") {
      return {
        type: "sprite",
        character_id: spriteCharacterId.trim() || "alice",
        sprite_id: spriteAssetId.trim(),
        position: spritePosition.trim() || "center",
        offset_x: spriteOffsetX,
        offset_y: spriteOffsetY,
        animation: "",
        animation_display_name: spriteAnimationConfig.display_name ?? "",
        animation_config: { ...spriteAnimationConfig, phase: spriteVisible ? spriteAnimationConfig.phase : "exit" },
        scale: spriteScale,
        visible: spriteVisible,
      };
    }
    if (commandType === "animation") {
      const compiled = animationId ? null : compileCharacterAnimation(animationConfig, null, null, true);
      return {
        type: "animation",
        animation_id: animationId.trim() || "custom",
        ...(animationId ? { animation_asset_id: animationId } : {}),
        animation_display_name: animationConfig.display_name ?? "",
        target: animationTarget.trim() || spriteTargetForCharacter("selected"),
        params: animationId ? {} : compiled?.params ?? { duration: 500 },
        blocking: compiled?.blocking ?? true,
      };
    }
    return defaultCommand(commandType);
  }

  function handleTypeSelect(type: GameCommandType) {
    if (prefersReducedMotion) {
      setPressedType(null);
      setPulseType(null);
      setCommandType(type);
      return;
    }
    if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    captureDetailRect();
    clearDetailMorphSettleTimer();
    detailMorphRef.current?.cancel();
    setDetailMorphPhase("idle");
    setPressedType(type);
    setCommandType(type);
    pressTimerRef.current = window.setTimeout(() => {
      setPressedType((current) => (current === type ? null : current));
      setPulseType(type);
      pulseTimerRef.current = window.setTimeout(() => {
        setPulseType((current) => (current === type ? null : current));
      }, 320);
    }, 90);
  }

  useEffect(() => {
    if (!requestedCommand || requestedCommand.sceneId !== sceneId) return;
    handleTypeSelect(requestedCommand.type);
    if (requestedCommand.characterId && requestedCommand.type === "sprite")
      setSpriteCharacterId(requestedCommand.characterId);
  }, [requestedCommand, sceneId]);

  function requestMinimize() {
    if (closeRequested) return;
    (onMinimize ?? onClose)?.();
  }

  function requestClose() {
    if (!onClose || closeRequested) return;
    onClose();
  }

  function submitCommand() {
    if (commandType === "animation" && (animationAssetPending || animationAssetError)) return;
    if (commandType === "camera" && onOpenCameraStudio) {
      onOpenCameraStudio();
      return;
    }
    onAdd(buildCommand());
  }

  function openInsertPopover() {
    if (!onInsert || commands.length === 0 || commandType === "camera") return;
    setInsertAfterInput("");
    setInsertError("");
    setInsertPopoverOpen(true);
  }

  function submitInsert(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!onInsert) return;
    if (commandType === "animation" && (animationAssetPending || animationAssetError)) return;
    const afterIndex = Number(insertAfterInput);
    if (!Number.isInteger(afterIndex) || afterIndex < 1 || afterIndex > commands.length) {
      setInsertError(`请输入 1 到 ${commands.length} 之间的整数序号`);
      insertInputRef.current?.focus();
      return;
    }
    onInsert(buildCommand(), afterIndex);
    closeInsertPopover();
  }

  function renderQuickFields() {
    const characterOptions = Array.from(new Set(["alice", ...characterIds, spriteCharacterId].filter((id) => id && id !== "selected" && id !== "all")));
    if (displayType === "bgm") {
      return (
        <div className="workbench-quick-fields">
          <strong>
            <Music2 size={15} /> 背景音乐
          </strong>
          {bgmAction === "play" && (
            <AssetPicker
              label="背景音乐素材"
              field="bgm_id"
              value={bgmId}
              allowedTypes={["bgm"]}
              helpKey="command.bgm.bgmId"
              emptyLabel="暂无可用背景音乐素材"
              variant="popover"
              onChange={setBgmId}
            />
          )}
          <label>
            播放动作
            <RichSelect
              value={bgmAction}
              options={[
                { value: "play", label: "播放" },
                { value: "stop", label: "停止" },
              ]}
              helpKey="command.bgm.action"
              onChange={(nextAction) => setBgmAction(nextAction as BgmAction)}
            />
          </label>
          <label>
            {bgmAction === "play" ? "播放效果" : "停止效果"}
            <RichSelect
              value={bgmFadeMs > 0 ? "fade" : "instant"}
              options={bgmAction === "play"
                ? [
                    { value: "fade", label: "淡入" },
                    { value: "instant", label: "立即播放" },
                  ]
                : [
                    { value: "fade", label: "淡出" },
                    { value: "instant", label: "立即停止" },
                  ]}
              helpKey="command.bgm.fadeMs"
              onChange={(effect) => setBgmFadeMs(effect === "fade" ? (bgmFadeMs || DEFAULT_BGM_FADE_MS) : 0)}
            />
          </label>
          {bgmFadeMs > 0 && (
            <label>
              {bgmAction === "play" ? "淡入时长（毫秒）" : "淡出时长（毫秒）"}
              <input
                type="number"
                min="0"
                step="100"
                value={bgmFadeMs}
                data-help-key="command.bgm.fadeMs"
                onChange={(event) => setBgmFadeMs(Math.max(0, Number(event.target.value)))}
              />
            </label>
          )}
        </div>
      );
    }
    if (displayType === "show_image") {
      return (
        <div className="workbench-quick-fields">
          <strong>
            <ScanSearch size={15} /> 展示图片
          </strong>
          <AssetPicker
            label="聚焦图片素材"
            field="image_id"
            value={showImageId}
            allowedTypes={["background", "sprite", "portrait", "ui"]}
            helpKey="command.showImage.imageId"
            emptyLabel="暂无可用图片素材"
            variant="popover"
            onChange={setShowImageId}
          />
          <label>
            图片填充方式
            <RichSelect
              value={showImageFit}
              options={[
                { value: "contain", label: "完整显示" },
                { value: "cover", label: "覆盖裁切" },
                { value: "stretch", label: "拉伸填满" },
              ]}
              helpKey="command.showImage.imageFit"
              onChange={(value) => setShowImageFit(value as typeof showImageFit)}
            />
          </label>
        </div>
      );
    }
    if (displayType === "sprite") {
      return (
        <div className="workbench-quick-fields character-workbench-fields">
          <strong>
            <MonitorPlay size={15} /> 角色立绘
          </strong>
          <div className="character-target-panel">
            <label>
              角色
              <RichSelect
                value={spriteCharacterId}
                options={characterOptions.map((id) => ({ value: id, label: id }))}
                helpKey="command.sprite.characterTarget"
                onChange={setSpriteCharacterId}
              />
            </label>
            <label>
              自定义角色 ID
              <input value={spriteCharacterId} data-help-key="command.sprite.characterId" onChange={(event) => setSpriteCharacterId(event.target.value)} />
            </label>
          </div>
          <AssetPicker
            label="立绘素材"
            field="sprite_id"
            value={spriteAssetId}
            allowedTypes={["sprite"]}
            helpKey="command.sprite.spriteId"
            emptyLabel="暂无可用立绘素材"
            variant="popover"
            onChange={setSpriteAssetId}
          />
          <div className="character-target-panel">
            <label>
              位置
              <RichSelect
                value={spritePosition}
                options={[
                  { value: "left", label: "左侧" },
                  { value: "center", label: "居中" },
                  { value: "right", label: "右侧" },
                  { value: "foreground", label: "前景" },
                  { value: "background", label: "后景" },
                ]}
                helpKey="command.sprite.position"
                onChange={setSpritePosition}
              />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={spriteVisible} data-help-key="command.sprite.visible" onChange={(event) => setSpriteVisible(event.target.checked)} />
              显示立绘
            </label>
          </div>
          <section className="sprite-placement-summary" aria-label="立绘位置与缩放">
            <div>
              <strong>立绘位置与缩放</strong>
              <span>
                {spritePosition || "center"} · X {sanitizeSpriteOffsetX(spriteOffsetX).toFixed(1)}%
                {" · "}Y {sanitizeSpriteOffsetY(spriteOffsetY).toFixed(1)}%
                {" · "}{spriteScalePercent(sanitizeSpriteScale(spriteScale, DEFAULT_SPRITE_SCALE))}
              </span>
            </div>
            <button type="button" data-help-key="command.sprite.placementStudio" onClick={() => setSpritePlacementOpen(true)}>
              <Move3d size={16} />
              调整立绘
            </button>
          </section>
          <CharacterAnimationControls
            value={spriteAnimationConfig}
            visible={spriteVisible}
            compact
            studioTitle="立绘动效工作室"
            targetLabel={`${spriteCharacterId || "角色"} 立绘`}
            onChange={(next) => setSpriteAnimationConfig(next ?? { ...defaultCharacterAnimationConfig(spriteVisible), kind: "none" })}
          />
        </div>
      );
    }
    if (displayType === "animation") {
      const spriteTargetId = characterIdFromSpriteTarget(animationTarget) || "selected";
      const targetOptions = Array.from(new Set(["selected", "all", ...characterOptions, spriteTargetId].filter(Boolean)));
      return (
        <div className="workbench-quick-fields">
          <strong>
            <Maximize2 size={15} /> 演出动画
          </strong>
          <AssetPicker
            label="演出动画素材"
            field="animation_asset_id"
            value={animationId}
            allowedTypes={["animation"]}
            helpKey="command.animation.animationId"
            emptyLabel="暂无可用动画素材"
            variant="popover"
            onChange={(id, asset) => void selectAnimationAsset(id, asset)}
          />
          {animationAssetPending && <span role="status">正在检查动画素材…</span>}
          {animationAssetError && <span role="alert">{animationAssetError}</span>}
          <label>
            动画目标
            <input value={animationTarget} data-help-key="command.animation.target" onChange={(event) => setAnimationTarget(event.target.value)} />
          </label>
          <div className="character-target-panel">
            <label>
              角色目标
              <RichSelect
                value={spriteTargetId}
                options={targetOptions.map((id) => ({ value: id, label: id === "selected" ? "当前立绘" : id === "all" ? "全部立绘" : id }))}
                helpKey="command.animation.spriteTarget"
                onChange={(nextTargetId) => setAnimationTarget(spriteTargetForCharacter(nextTargetId))}
              />
            </label>
            <label>
              自定义角色 ID
              <input data-help-key="command.animation.spriteTargetCustom" value={spriteTargetId} onChange={(event) => setAnimationTarget(spriteTargetForCharacter(event.target.value))} />
            </label>
          </div>
          {!animationId && <CharacterAnimationControls
            value={animationConfig}
            compact
            studioTitle="演出动效工作室"
            targetLabel={animationTarget || "动画目标"}
            onChange={(next) => setAnimationConfig(next ?? { ...defaultCharacterAnimationConfig(true), kind: "none" })}
          />}
        </div>
      );
    }
    if (displayType === "camera") {
      return (
        <div className="workbench-quick-fields">
          <strong>
            <Clapperboard size={15} /> 运镜
          </strong>
        </div>
      );
    }
    return null;
  }

  const detailHasSettings = displayType === "bgm" || displayType === "show_image" || displayType === "sprite" || displayType === "animation" || displayType === "camera";

  const workbench = (
    <aside
      className={`floating-command-workbench${isClosing || closeRequested ? " is-closing" : ""}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      aria-label="事件工作台"
    >
      <header onPointerDown={startMove}>
        <span className="floating-command-title">
          <Sparkles size={15} /> 事件工作台
        </span>
        <small>拖拽标题移动</small>
        {(onMinimize || onClose) && (
          <span className="floating-command-window-actions" role="group" aria-label="事件工作台窗口操作">
            {(onMinimize || onClose) && (
              <button
                type="button"
                className="floating-command-minimize"
                data-help-key="workbench.minimize"
                aria-label="最小化事件工作台"
                title="最小化事件工作台"
                data-tooltip="最小化事件工作台"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  requestMinimize();
                }}
              >
                <Minus size={15} aria-hidden="true" />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                className="floating-command-close"
                data-help-key="workbench.close"
                aria-label="关闭事件工作台"
                title="关闭事件工作台"
                data-tooltip="关闭事件工作台"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  requestClose();
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </span>
        )}
      </header>
      <div className="floating-command-workbench-body">
        <div className="workbench-category-grid">
          {workbenchGroups.map((group) => {
            const active = group.types.includes(commandType);
            return (
              <section
                key={group.id}
                className={`workbench-category-card${active ? " is-active" : ""}`}
                data-group-id={group.id}
              >
                <div className="workbench-category-head">
                  <strong>{group.title}</strong>
                </div>
                <div className="workbench-type-grid">
                  {group.types.map((type) => {
                    const Icon = commandIcon(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        className={`workbench-type-button${commandType === type ? " is-active" : ""}${pressedType === type ? " is-pressing" : ""}${pulseType === type ? " is-pulsing" : ""}`}
                        data-help-key="workbench.commandType"
                        data-command-type={type}
                        onClick={() => handleTypeSelect(type)}
                      >
                        <Icon size={15} aria-hidden="true" />
                        <span>{commandLabels[type]}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <section
          ref={detailCardRef}
          className={`workbench-detail-card ${detailHasSettings ? "has-settings" : "is-compact"} is-${transitionPhase}${detailMorphPhase !== "idle" ? ` is-${detailMorphPhase}` : ""}`}
        >
          <header>
            <strong>{quickPanelTitle(displayType)}</strong>
          </header>
          <div className="workbench-detail-content">{renderQuickFields()}</div>
        </section>
        <div className="workbench-submit-actions">
          <button type="button" className="workbench-submit" data-testid="workbench-add-command" data-help-key="workbench.addCommand" disabled={commandType === "animation" && (animationAssetPending || Boolean(animationAssetError))} onClick={submitCommand}>
            {commandType === "camera" ? "打开运镜工作室" : "添加到场景末尾"}
          </button>
          <button
            ref={insertTriggerRef}
            type="button"
            className="workbench-submit workbench-insert-trigger"
            data-testid="workbench-insert-command"
            data-help-key="workbench.insertCommand"
            aria-haspopup="dialog"
            aria-expanded={insertPopoverOpen}
            disabled={!onInsert || commands.length === 0 || commandType === "camera" || (commandType === "animation" && (animationAssetPending || Boolean(animationAssetError)))}
            title={commandType === "camera" ? "运镜请在事件列表中用＋运镜选择位置" : undefined}
            onClick={insertPopoverOpen ? closeInsertPopover : openInsertPopover}
          >
            <ListPlus size={16} aria-hidden="true" />
            插入到场景
          </button>
        </div>
      </div>
      <span className="floating-command-resize" data-help-key="workbench.resize" onPointerDown={startResize} />
    </aside>
  );

  return createPortal(
    <>
      {workbench}
      {insertPopoverOpen && createPortal(
        <section
          ref={insertPopoverRef}
          className="workbench-insert-popover"
          role="dialog"
          aria-labelledby="workbench-insert-title"
          aria-describedby="workbench-insert-description"
          data-placement={insertPopoverPosition.placement}
          style={{
            top: insertPopoverPosition.top,
            bottom: insertPopoverPosition.bottom,
            left: insertPopoverPosition.left,
            width: insertPopoverPosition.width,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="workbench-insert-popover-copy">
            <strong id="workbench-insert-title">
              <ListPlus size={16} aria-hidden="true" /> 插入到指定事件之后
            </strong>
            <span id="workbench-insert-description">输入 1～{commands.length}，插入到对应事件后面。</span>
          </div>
          <form className="workbench-insert-form" noValidate onSubmit={submitInsert}>
            <label htmlFor="workbench-insert-index">事件序号</label>
            <input data-help-key="editor.control"
              ref={insertInputRef}
              id="workbench-insert-index"
              type="number"
              inputMode="numeric"
              min={1}
              max={commands.length}
              step={1}
              value={insertAfterInput}
              aria-label="插入到第几个事件之后"
              aria-invalid={insertError ? "true" : "false"}
              aria-describedby={insertError ? "workbench-insert-error" : "workbench-insert-description"}
              onChange={(event) => {
                setInsertAfterInput(event.target.value);
                if (insertError) setInsertError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeInsertPopover();
                }
              }}
            />
            <div className="workbench-insert-actions">
              <button data-help-key="editor.control" type="button" onClick={closeInsertPopover}>取消</button>
              <button data-help-key="editor.control" type="submit" className="workbench-insert-confirm">确认插入</button>
            </div>
          </form>
          {insertError && <p id="workbench-insert-error" className="workbench-insert-error" role="alert">{insertError}</p>}
        </section>,
        document.body,
      )}
      {spritePlacementOpen && (
        <SpritePlacementStudioDialog
          command={{
            type: "sprite",
            character_id: spriteCharacterId.trim() || "alice",
            sprite_id: spriteAssetId.trim(),
            position: spritePosition.trim() || "center",
            offset_x: spriteOffsetX,
            offset_y: spriteOffsetY,
            scale: spriteScale,
            visible: spriteVisible,
          }}
          commands={commands}
          commandIndex={commands.length}
          sceneId={sceneId}
          onClose={() => setSpritePlacementOpen(false)}
          onApply={(layout, scope: SpritePlacementScope) => {
            const result = sceneId
              ? applySpritePlacementToNodes(nodes, sceneId, spriteCharacterId, layout, scope, useProjectStore.getState().settings)
              : undefined;
            if (result && result.changedCommands > 0) {
              setNodes(result.nodes);
            }
            setSpritePosition(layout.position || "center");
            setSpriteOffsetX(layout.offset_x);
            setSpriteOffsetY(layout.offset_y);
            setSpriteScale(layout.scale);
            if (scope === "character") {
              const ids = result?.matchingCharacterIds.length ? result.matchingCharacterIds : [spriteCharacterId];
              ids.filter(Boolean).forEach((characterId) => useProjectStore.getState().setCharacterSpriteLayout(characterId, layout));
            }
            const targetLabel = result?.targetDisplayName || spriteCharacterId || "当前角色";
            setNotice({
              message: scope === "character"
                ? `已应用到全部「${targetLabel}」立绘。`
                : `已应用到当前场景的「${targetLabel}」立绘。`,
              tone: "success",
              source: "立绘位置与缩放",
              detail: scope === "character"
                ? `更新 ${Math.max(1, result?.changedCommands ?? 1)} 条命令，并保存为角色默认布局。`
                : `更新 ${Math.max(1, result?.changedCommands ?? 1)} 条命令。`,
            });
            setSpritePlacementOpen(false);
          }}
        />
      )}
    </>,
    document.body,
  );
}
