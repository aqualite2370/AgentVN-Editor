import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
} from "react";
import { assetResolver } from "../../engine/assetResolver";
import type { RuntimeAnimationEffect, SpriteState } from "../../types/settings";
import { spriteEffectFor, spriteEffectTargetsCharacter, useRuntimeAnimation } from "./runtimeAnimation";
import { sanitizeSpriteLayer, spriteLayerZIndex } from "../../../../shared/cartridge/spriteLayer";
import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale } from "../../../../shared/cartridge/spriteScale";
import { sanitizeSpriteOffsetX, sanitizeSpriteOffsetY } from "../../../../shared/cartridge/spritePlacement";
import type { SpeakerFocusConfig } from "../../../../shared/cartridge/types";
import { DEFAULT_SPEAKER_FOCUS } from "../../../../shared/cartridge/speakerFocus";
import {
  orderedVisibleSprites,
  resolveSpriteSlotIndices,
  resolveSpriteSlotLayout,
  type SpriteStageSize,
} from "../../engine/spriteStageLayout";

type SpriteTransitionPhase = "entering" | "present" | "exiting";

interface RenderedSprite {
  key: string;
  sprite: SpriteState;
  phase: SpriteTransitionPhase;
  exitStartedAt?: number;
}

const spriteExitHoldMs = 620;

function classForPosition(position?: string | null): string {
  if (position === "left" || position === "right" || position === "center") return position;
  return "center";
}

function spriteSignature(sprite: SpriteState): string {
  return `${sprite.sprite_id}::${classForPosition(sprite.position)}`;
}

function spritePlacementSignature(sprite: SpriteState): string {
  return classForPosition(sprite.position);
}

function hasCustomExitAnimation(sprite: SpriteState): boolean {
  if (sprite.animation_config && sprite.animation_config.kind !== "none" && sprite.animation_config.phase === "exit") return true;
  return ["fade_out", "slide_out_left", "slide_out_right"].includes(sprite.animation ?? "");
}

function runtimeSpriteAnimationPhase(effect?: RuntimeAnimationEffect): string | undefined {
  const phase = effect?.params.character_animation_phase;
  return typeof phase === "string" ? phase : undefined;
}

function effectForRenderedSprite(item: RenderedSprite, effect?: RuntimeAnimationEffect): RuntimeAnimationEffect | undefined {
  if (item.phase === "exiting" && runtimeSpriteAnimationPhase(effect) !== "exit") return undefined;
  return effect;
}

type SpriteFocusStyle = CSSProperties & {
  "--sprite-focus-duration"?: string;
  "--sprite-base-scale"?: string;
  "--speaker-focus-scale"?: string;
  "--speaker-focus-duration"?: string;
};

interface SpriteVisualFrame {
  characterId: string;
  spriteId: string;
  position?: string | null;
  offsetX?: number | null;
  offsetY?: number | null;
  scale?: number | null;
}

interface SpriteReplacementPresentation {
  current: SpriteVisualFrame;
  previous?: SpriteVisualFrame;
  transition?: NonNullable<SpriteState["replacement"]>["transition"];
  replacementKey?: number;
  generation: number;
  transitionDeadline?: number;
}

type SpriteSwitchStyle = CSSProperties & {
  "--sprite-switch-duration"?: string;
  "--sprite-switch-easing"?: string;
};

type SpriteFrameStyle = CSSProperties & {
  "--sprite-base-scale": string;
  "--sprite-offset-x-px": string;
  "--sprite-offset-y-px": string;
};

function currentSpriteVisual(sprite: SpriteState): SpriteVisualFrame {
  return {
    characterId: sprite.character_id,
    spriteId: sprite.sprite_id,
    position: sprite.position,
    offsetX: sprite.offset_x,
    offsetY: sprite.offset_y,
    scale: sprite.scale,
  };
}

function previousSpriteVisual(sprite: SpriteState): SpriteVisualFrame | undefined {
  const replacement = sprite.replacement;
  if (!replacement || replacement.transition.kind === "none") return undefined;
  return {
    characterId: sprite.character_id,
    spriteId: replacement.previous_sprite_id,
    position: replacement.previous_position,
    offsetX: replacement.previous_offset_x,
    offsetY: replacement.previous_offset_y,
    scale: replacement.previous_scale,
  };
}

function spriteVisualSignature(visual: SpriteVisualFrame): string {
  return [
    visual.characterId,
    visual.spriteId,
    classForPosition(visual.position),
    sanitizeSpriteOffsetX(visual.offsetX),
    sanitizeSpriteOffsetY(visual.offsetY),
    sanitizeSpriteScale(visual.scale, DEFAULT_SPRITE_SCALE),
  ].join("|");
}

function spriteReplacementSignature(sprite: SpriteState): string {
  return [
    spriteVisualSignature(currentSpriteVisual(sprite)),
    sprite.replacement?.key ?? "",
    sprite.replacement?.transition.kind ?? "",
    sprite.replacement?.transition.duration_ms ?? "",
    sprite.replacement?.transition.easing ?? "",
  ].join("|");
}

function createSpritePresentation(sprite: SpriteState, generation: number): SpriteReplacementPresentation {
  const previous = previousSpriteVisual(sprite);
  const transition = previous ? sprite.replacement?.transition : undefined;
  return {
    current: currentSpriteVisual(sprite),
    previous,
    transition,
    replacementKey: previous ? sprite.replacement?.key : undefined,
    generation,
    transitionDeadline: transition ? Date.now() + transition.duration_ms : undefined,
  };
}

function SpriteReplacementFrame({
  visual,
  role,
  transitionKind,
  stageSize,
  onAnimationEnd,
}: {
  visual: SpriteVisualFrame;
  role: "previous" | "current";
  transitionKind?: NonNullable<SpriteState["replacement"]>["transition"]["kind"];
  stageSize: SpriteStageSize;
  onAnimationEnd?: (event: AnimationEvent<HTMLDivElement>) => void;
}) {
  const url = assetResolver.resolveSprite(visual.spriteId);
  const offsetX = sanitizeSpriteOffsetX(visual.offsetX);
  const offsetY = sanitizeSpriteOffsetY(visual.offsetY);
  const style: SpriteFrameStyle = {
    "--sprite-base-scale": String(sanitizeSpriteScale(visual.scale, DEFAULT_SPRITE_SCALE)),
    "--sprite-offset-x-px": `${stageSize.width * offsetX / 100}px`,
    "--sprite-offset-y-px": `${stageSize.height * offsetY / 100}px`,
  };
  return (
    <div
      className={`sprite-replacement-frame is-${role}${transitionKind ? ` sprite-switch-${transitionKind}` : ""}`}
      data-sprite-role={role}
      data-character-id={visual.characterId}
      data-sprite-id={visual.spriteId}
      data-sprite-position={classForPosition(visual.position)}
      data-sprite-offset-x={offsetX}
      data-sprite-offset-y={offsetY}
      data-sprite-scale={style["--sprite-base-scale"]}
      aria-hidden={role === "previous" ? "true" : undefined}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="sprite-placement-frame" style={style}>
        {url
          ? <img className="sprite-visual" src={url} alt={role === "current" ? visual.characterId : ""} />
          : <div className="sprite-placeholder">{visual.spriteId}</div>}
      </div>
    </div>
  );
}

function SpriteSlot({
  sprite,
  effect,
  focusEffect,
  selectedCharacterId,
  speakingCharacterId,
  speakerFocus,
  speakingZIndex,
  phase,
  slotStyle,
  stageSize,
  presentationMode,
}: {
  sprite: SpriteState;
  effect?: RuntimeAnimationEffect;
  focusEffect?: RuntimeAnimationEffect;
  selectedCharacterId?: string;
  speakingCharacterId?: string;
  speakerFocus: SpeakerFocusConfig;
  speakingZIndex: number;
  phase: SpriteTransitionPhase;
  slotStyle?: CSSProperties;
  stageSize: SpriteStageSize;
  presentationMode: "animate" | "settle";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isFocusTarget = focusEffect ? spriteEffectTargetsCharacter(focusEffect, sprite.character_id, selectedCharacterId) : false;
  const isFocusCompanion = Boolean(focusEffect && !isFocusTarget);
  const isSpeaking = speakerFocus.enabled && phase !== "exiting" && sprite.character_id === speakingCharacterId;
  const incomingSignature = spriteReplacementSignature(sprite);
  const observedSignatureRef = useRef(incomingSignature);
  const consumedReplacementKeyRef = useRef(sprite.replacement?.key);
  const [presentation, setPresentation] = useState<SpriteReplacementPresentation>(() => (
    presentationMode === "settle"
      ? { current: currentSpriteVisual(sprite), generation: 0 }
      : createSpritePresentation(sprite, 0)
  ));
  const style = {
    ...slotStyle,
    ...(isSpeaking ? { zIndex: speakingZIndex } : {}),
    ...(focusEffect ? { "--sprite-focus-duration": `${focusEffect.duration_ms}ms` } : {}),
    "--speaker-focus-scale": String(isSpeaking ? speakerFocus.scale : 1),
    "--speaker-focus-duration": `${speakerFocus.duration_ms}ms`,
  } as SpriteFocusStyle;
  useRuntimeAnimation(ref, effect, sprite.character_id);
  const replacementIsVisible = phase === "present" && Boolean(presentation.previous);

  const clearPrevious = useCallback((activeGeneration: number) => {
    setPresentation((current) => {
      if (!current.previous || current.generation !== activeGeneration) return current;
      return {
        current: current.current,
        generation: current.generation,
      };
    });
  }, []);

  useLayoutEffect(() => {
    if (observedSignatureRef.current === incomingSignature) return;
    observedSignatureRef.current = incomingSignature;
    setPresentation((current) => {
      const nextGeneration = current.generation + 1;
      const replacementKey = sprite.replacement?.key;
      const shouldAnimate = presentationMode !== "settle" && Boolean(
        sprite.replacement
        && sprite.replacement.transition.kind !== "none"
        && replacementKey !== consumedReplacementKeyRef.current,
      );
      if (!shouldAnimate) {
        return {
          current: currentSpriteVisual(sprite),
          generation: nextGeneration,
        };
      }
      consumedReplacementKeyRef.current = replacementKey;
      return createSpritePresentation(sprite, nextGeneration);
    });
  }, [
    incomingSignature,
    sprite.character_id,
    sprite.position,
    sprite.replacement,
    sprite.scale,
    sprite.sprite_id,
    presentationMode,
  ]);

  useLayoutEffect(() => {
    if (presentationMode !== "settle") return;
    observedSignatureRef.current = incomingSignature;
    setPresentation((current) => ({
      current: currentSpriteVisual(sprite),
      generation: current.generation + 1,
    }));
  }, [incomingSignature, presentationMode, sprite]);

  useEffect(() => {
    if (!presentation.previous || !presentation.transition || !presentation.transitionDeadline) return;
    const activeGeneration = presentation.generation;
    const timer = window.setTimeout(
      () => clearPrevious(activeGeneration),
      Math.max(0, presentation.transitionDeadline + 180 - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [
    clearPrevious,
    presentation.generation,
    presentation.previous,
    presentation.transition,
    presentation.transitionDeadline,
  ]);

  useLayoutEffect(() => {
    if (phase === "present" || !presentation.previous) return;
    clearPrevious(presentation.generation);
  }, [clearPrevious, phase, presentation.generation, presentation.previous]);

  function handleCurrentAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target || !replacementIsVisible) return;
    clearPrevious(presentation.generation);
  }

  const transitionKind = replacementIsVisible ? presentation.transition?.kind : undefined;
  const replacementStyle: SpriteSwitchStyle = replacementIsVisible && presentation.transition
    ? {
        "--sprite-switch-duration": `${presentation.transition.duration_ms}ms`,
        "--sprite-switch-easing": presentation.transition.easing,
      }
    : {};

  return (
    <div
      className={`sprite-slot ${classForPosition(sprite.position)} is-${phase}${effect ? " has-runtime-animation" : ""}${isFocusCompanion ? " is-focus-companion" : ""}${isSpeaking ? " is-speaking" : ""}`}
      data-character-id={sprite.character_id}
      data-sprite-id={sprite.sprite_id}
      data-sprite-layer={sanitizeSpriteLayer(sprite.layer)}
      data-sprite-z-index={spriteLayerZIndex(sprite.layer, phase === "exiting")}
      data-runtime-animation-active={effect ? "true" : "false"}
      data-runtime-animation-id={effect?.animation_id ?? ""}
      data-runtime-effect-id={effect?.effect_id ?? ""}
      data-runtime-animation-target={effect?.target ?? ""}
      data-sprite-phase={phase}
      data-sprite-focus-role={isFocusTarget ? "target" : isFocusCompanion ? "companion" : "none"}
      data-sprite-replacement-active={replacementIsVisible ? "true" : "false"}
      data-sprite-replacement-key={replacementIsVisible ? presentation.replacementKey ?? "" : ""}
      data-sprite-transition-kind={transitionKind ?? sprite.replacement?.transition.kind ?? ""}
      style={style}
    >
      <div className="speaker-focus-frame">
        <div
          className="sprite-animation-frame"
          ref={ref}
          data-character-id={sprite.character_id}
          data-sprite-id={sprite.sprite_id}
          data-runtime-animation-active={effect ? "true" : "false"}
          data-runtime-animation-id={effect?.animation_id ?? ""}
          data-runtime-effect-id={effect?.effect_id ?? ""}
          data-runtime-animation-target={effect?.target ?? ""}
        >
          <div
            className={`sprite-replacement-stack${replacementIsVisible ? " is-switching" : ""}${transitionKind ? ` sprite-switch-${transitionKind}` : ""}`}
            style={replacementStyle}
          >
            {replacementIsVisible && presentation.previous && (
              <SpriteReplacementFrame
                key={`previous:${presentation.replacementKey}:${spriteVisualSignature(presentation.previous)}`}
                visual={presentation.previous}
                role="previous"
                transitionKind={transitionKind}
                stageSize={stageSize}
              />
            )}
            <SpriteReplacementFrame
              key={`current:${presentation.replacementKey ?? "stable"}:${spriteVisualSignature(presentation.current)}`}
              visual={presentation.current}
              role="current"
              transitionKind={transitionKind}
              stageSize={stageSize}
              onAnimationEnd={handleCurrentAnimationEnd}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SpriteLayer({
  sprites,
  spriteOrder = [],
  effects = [],
  focusEffect,
  speakingCharacterId,
  speakerFocus = DEFAULT_SPEAKER_FOCUS,
  presentationMode = "animate",
}: {
  sprites: Record<string, SpriteState>;
  spriteOrder?: string[];
  effects?: RuntimeAnimationEffect[];
  focusEffect?: RuntimeAnimationEffect;
  speakingCharacterId?: string;
  speakerFocus?: SpeakerFocusConfig;
  presentationMode?: "animate" | "settle";
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<SpriteStageSize>({ width: 0, height: 0, uiScale: 1 });
  const visibleSprites = useMemo(() => orderedVisibleSprites(sprites, spriteOrder), [sprites, spriteOrder]);
  const selectedCharacterId = visibleSprites.length > 0 ? visibleSprites[visibleSprites.length - 1].character_id : undefined;
  const keyIndexRef = useRef(0);
  const [renderedSprites, setRenderedSprites] = useState<RenderedSprite[]>(() =>
    visibleSprites.map((sprite) => ({
      key: `${sprite.character_id}:${spriteSignature(sprite)}:${keyIndexRef.current++}`,
      sprite,
      phase: presentationMode === "settle" ? "present" : "entering",
    }))
  );

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const updateSize = () => {
      const rect = layer.getBoundingClientRect();
      const rawUiScale = Number.parseFloat(getComputedStyle(layer).getPropertyValue("--runtime-ui-scale"));
      const uiScale = Number.isFinite(rawUiScale) && rawUiScale > 0 ? rawUiScale : 1;
      setStageSize((current) => (
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          && Math.abs(current.uiScale - uiScale) < 0.001
          ? current
          : { width: rect.width, height: rect.height, uiScale }
      ));
    };
    updateSize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateSize);
    observer?.observe(layer);
    window.addEventListener("resize", updateSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  useEffect(() => {
    setRenderedSprites((current) => {
      const activeByCharacter = new Map<string, RenderedSprite>();
      current.forEach((item) => {
        if (item.phase !== "exiting") {
          activeByCharacter.set(item.sprite.character_id, item);
        }
      });

      const nextByCharacter = new Map(visibleSprites.map((sprite) => [sprite.character_id, sprite]));
      const nextRendered: RenderedSprite[] = current.filter((item) => item.phase === "exiting");

      current.forEach((item) => {
        if (item.phase === "exiting") return;
        const nextSprite = nextByCharacter.get(item.sprite.character_id);
        if (!nextSprite) {
          if (!nextSprite && hasCustomExitAnimation(item.sprite)) return;
          nextRendered.push({ ...item, phase: "exiting", exitStartedAt: Date.now() });
          return;
        }
        const samePlacement = spritePlacementSignature(nextSprite) === spritePlacementSignature(item.sprite);
        if (!samePlacement) {
          nextRendered.push({ ...item, phase: "exiting", exitStartedAt: Date.now() });
        }
      });

      visibleSprites.forEach((sprite) => {
        const active = activeByCharacter.get(sprite.character_id);
        if (active && spritePlacementSignature(active.sprite) === spritePlacementSignature(sprite)) {
          nextRendered.push({ ...active, sprite, phase: "present" });
          return;
        }

        nextRendered.push({
          key: `${sprite.character_id}:${spriteSignature(sprite)}:${keyIndexRef.current++}`,
          sprite,
          phase: presentationMode === "settle" ? "present" : "entering",
        });
      });

      return nextRendered;
    });
  }, [presentationMode, visibleSprites]);

  useEffect(() => {
    if (!renderedSprites.some((sprite) => sprite.phase === "exiting")) return undefined;
    const timer = window.setTimeout(() => {
      setRenderedSprites((current) => current.filter((sprite) => sprite.phase !== "exiting" || Date.now() - (sprite.exitStartedAt ?? 0) < spriteExitHoldMs));
    }, spriteExitHoldMs + 40);
    return () => window.clearTimeout(timer);
  }, [renderedSprites]);

  const presentSprites = renderedSprites.filter((item) => item.phase !== "exiting");
  const speakingZIndex = presentSprites.reduce(
    (highest, item) => Math.max(highest, spriteLayerZIndex(item.sprite.layer, false)),
    spriteLayerZIndex(undefined, false),
  ) + 2;
  const orderedPresentKeys = presentSprites.map((item) => item.key);
  const presentSlotIndices = resolveSpriteSlotIndices(presentSprites.map((item) => item.sprite));
  const activeSlotCount = Math.max(1, orderedPresentKeys.length);
  const activeSlotWidth = Math.max(18, Math.min(34, 86 / activeSlotCount));

  return (
    <div
      ref={layerRef}
      className={`sprite-layer${activeSlotCount > 1 ? " has-multiple-sprites" : ""}`}
      style={{
        "--sprite-active-count": String(activeSlotCount),
        "--sprite-slot-width": `${activeSlotWidth}%`,
      } as CSSProperties}
    >
      {renderedSprites.map((item) => {
        const effect = spriteEffectFor(effects, item.sprite.character_id, selectedCharacterId);
        const slotIndex = presentSlotIndices.get(item.sprite.character_id);
        const slotLayout = slotIndex !== undefined && stageSize.width > 0 && stageSize.height > 0
          ? resolveSpriteSlotLayout({
              stage: stageSize,
              spriteCount: activeSlotCount,
              spriteIndex: slotIndex,
              position: item.sprite.position,
            })
          : undefined;
        const placementStyle = slotLayout ? {
          left: `${slotLayout.left}px`,
          right: "auto",
          bottom: `${slotLayout.bottom}px`,
          width: `${slotLayout.width}px`,
          height: `${slotLayout.height}px`,
          transform: "none",
        } : {};
        return (
          <SpriteSlot
            key={item.key}
            sprite={item.sprite}
            phase={item.phase}
            effect={effectForRenderedSprite(item, effect)}
            focusEffect={focusEffect}
            selectedCharacterId={selectedCharacterId}
            speakingCharacterId={speakingCharacterId}
            speakerFocus={speakerFocus}
            speakingZIndex={speakingZIndex}
            stageSize={stageSize}
            presentationMode={presentationMode}
            slotStyle={{
              ...placementStyle,
              zIndex: spriteLayerZIndex(item.sprite.layer, item.phase === "exiting"),
            }}
          />
        );
      })}
    </div>
  );
}
