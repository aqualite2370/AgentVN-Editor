import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { JsonValue } from "../../types/commands";
import type { RuntimeAnimationEffect } from "../../types/settings";
import { SPRITE_FOCUS_PRESET_ID } from "../../../../shared/animation/characterAnimation";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

type RuntimeKeyframe = {
  offset?: number;
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  blur?: number;
  brightness?: number;
  easing?: string;
};

type RuntimeAnimationProbeEntry = {
  time: number;
  event: string;
  effect_id?: string;
  animation_id?: string;
  target?: string;
  target_kind?: string;
  target_id?: string;
  character_id?: string;
  active_animations?: number;
  details?: Record<string, unknown>;
};

const activeRuntimePlaybackKeys = new Map<string, Animation>();
const activeRuntimeTargetAnimations = new Map<string, Animation>();
const startedRuntimePlaybackKeys: string[] = [];
const startedRuntimePlaybackKeySet = new Set<string>();
const startedRuntimePlaybackKeyExpiry = new Map<string, number>();
const maxStartedRuntimePlaybackKeys = 500;
const minStartedRuntimePlaybackKeyTtlMs = 1200;

function pruneStartedRuntimePlaybackKeys(now = performance.now()): void {
  for (const [key, expiresAt] of startedRuntimePlaybackKeyExpiry) {
    if (expiresAt > now) continue;
    startedRuntimePlaybackKeyExpiry.delete(key);
    startedRuntimePlaybackKeySet.delete(key);
  }
}

function hasStartedRuntimePlaybackKey(playbackKey: string): boolean {
  pruneStartedRuntimePlaybackKeys();
  return startedRuntimePlaybackKeySet.has(playbackKey);
}

function rememberStartedRuntimePlaybackKey(playbackKey: string, ttlMs = minStartedRuntimePlaybackKeyTtlMs): void {
  pruneStartedRuntimePlaybackKeys();
  const expiresAt = performance.now() + Math.max(minStartedRuntimePlaybackKeyTtlMs, ttlMs);
  startedRuntimePlaybackKeyExpiry.set(playbackKey, expiresAt);
  if (startedRuntimePlaybackKeySet.has(playbackKey)) return;
  startedRuntimePlaybackKeySet.add(playbackKey);
  startedRuntimePlaybackKeys.push(playbackKey);
  while (startedRuntimePlaybackKeys.length > maxStartedRuntimePlaybackKeys) {
    const removed = startedRuntimePlaybackKeys.shift();
    if (removed) {
      startedRuntimePlaybackKeySet.delete(removed);
      startedRuntimePlaybackKeyExpiry.delete(removed);
    }
  }
}

function recordRuntimeAnimationProbe(entry: RuntimeAnimationProbeEntry): void {
  if (typeof window === "undefined") return;
  const host = window as Window & { __AGENTVN_RUNTIME_ANIMATION_LOG__?: RuntimeAnimationProbeEntry[] };
  const list = host.__AGENTVN_RUNTIME_ANIMATION_LOG__ ?? [];
  list.push({ ...entry, time: entry.time || performance.now() });
  host.__AGENTVN_RUNTIME_ANIMATION_LOG__ = list.slice(-500);
  window.dispatchEvent(new CustomEvent("agentvn:runtime-animation", { detail: host.__AGENTVN_RUNTIME_ANIMATION_LOG__[host.__AGENTVN_RUNTIME_ANIMATION_LOG__.length - 1] }));
}

function asNumber(value: JsonValue | undefined, fallback?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: JsonValue | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeEasing(value: string | undefined, fallback = "ease-out"): string {
  const easing = value?.trim();
  if (!easing) return fallback;
  if (typeof CSS !== "undefined" && CSS.supports?.("animation-timing-function", easing)) return easing;
  return fallback;
}

function asBoolean(value: JsonValue | undefined): boolean {
  return value === true || value === "true";
}

function parseKeyframes(value: JsonValue | undefined): RuntimeKeyframe[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, JsonValue> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      offset: asNumber(item.offset),
      opacity: asNumber(item.opacity),
      x: asNumber(item.x),
      y: asNumber(item.y),
      scale: asNumber(item.scale),
      rotate: asNumber(item.rotate),
      blur: asNumber(item.blur),
      brightness: asNumber(item.brightness),
      easing: optionalString(item.easing),
    }));
}

function fallbackKeyframes(animationId: string): RuntimeKeyframe[] {
  if (animationId.includes("shake")) {
    return [
      { offset: 0, x: 0 },
      { offset: 0.3, x: -14 },
      { offset: 0.6, x: 12 },
      { offset: 1, x: 0 },
    ];
  }
  if (animationId.includes("out")) return [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }];
  if (animationId.includes("zoom") || animationId.includes("push")) return [{ offset: 0, scale: 1 }, { offset: 1, scale: 1.06 }];
  return [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }];
}

function compileKeyframe(keyframe: RuntimeKeyframe): Keyframe {
  const transform = [
    keyframe.x !== undefined || keyframe.y !== undefined ? `translate3d(${keyframe.x ?? 0}px, ${keyframe.y ?? 0}px, 0)` : "",
    keyframe.scale !== undefined ? `scale(${keyframe.scale})` : "",
    keyframe.rotate !== undefined ? `rotate(${keyframe.rotate}deg)` : "",
  ].filter(Boolean).join(" ");
  const filter = [
    keyframe.blur !== undefined ? `blur(${keyframe.blur}px)` : "",
    keyframe.brightness !== undefined ? `brightness(${keyframe.brightness})` : "",
  ].filter(Boolean).join(" ");
  return {
    offset: keyframe.offset,
    opacity: keyframe.opacity,
    transform: transform || undefined,
    filter: filter || undefined,
    easing: keyframe.easing ? safeEasing(keyframe.easing) : undefined,
  };
}

function compileRuntimeAnimation(effect: RuntimeAnimationEffect): { keyframes: Keyframe[]; options: KeyframeAnimationOptions; transformOrigin?: string; loops: boolean } {
  const rawKeyframes = parseKeyframes(effect.params.keyframes) || [];
  const keyframes = (rawKeyframes.length > 0 ? rawKeyframes : fallbackKeyframes(effect.animation_id)).map(compileKeyframe);
  const loops = asBoolean(effect.params.loop);
  return {
    keyframes,
    options: {
      duration: asNumber(effect.params.duration, effect.duration_ms) ?? effect.duration_ms,
      delay: asNumber(effect.params.delay_ms, asNumber(effect.params.delay, 0)) ?? 0,
      easing: safeEasing(asString(effect.params.easing, "ease-out")),
      iterations: loops ? Infinity : 1,
      direction: asString(effect.params.direction, "normal") as PlaybackDirection,
      fill: "both",
    },
    transformOrigin: optionalString(effect.params.transform_origin),
    loops,
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function usesTextRenderingLayer(effect: RuntimeAnimationEffect): boolean {
  return effect.target_kind === "dialog" || effect.target_kind === "ui" || effect.target_kind === "screen";
}

export function latestEffect(effects: RuntimeAnimationEffect[], predicate: (effect: RuntimeAnimationEffect) => boolean): RuntimeAnimationEffect | undefined {
  const matched = effects.filter(predicate);
  return matched.length > 0 ? matched[matched.length - 1] : undefined;
}

export function isSpriteFocusEffect(effect: RuntimeAnimationEffect | undefined): effect is RuntimeAnimationEffect {
  return Boolean(effect && effect.target_kind === "sprite" && (
    effect.animation_id === SPRITE_FOCUS_PRESET_ID || effect.params.scene_focus === true
  ));
}

export function spriteEffectTargetsCharacter(effect: RuntimeAnimationEffect, characterId: string, selectedCharacterId?: string): boolean {
  const id = effect.target_id?.trim();
  if (!id || id === "all") return true;
  if (id === "selected") return selectedCharacterId === characterId;
  return id === characterId;
}

export function spriteEffectFor(effects: RuntimeAnimationEffect[], characterId: string, selectedCharacterId?: string): RuntimeAnimationEffect | undefined {
  return latestEffect(effects, (effect) => {
    if (effect.target_kind !== "sprite") return false;
    return spriteEffectTargetsCharacter(effect, characterId, selectedCharacterId);
  });
}

function runtimeEffectKey(effect?: RuntimeAnimationEffect): string | undefined {
  if (!effect) return undefined;
  return JSON.stringify({
    effect_id: effect.effect_id,
    animation_id: effect.animation_id,
    target: effect.target,
    target_kind: effect.target_kind,
    target_id: effect.target_id,
    duration_ms: effect.duration_ms,
    params: effect.params,
  });
}

function runtimePlaybackKey(effect?: RuntimeAnimationEffect): string | undefined {
  if (!effect) return undefined;
  const explicitPlaybackId = effect.playback_id?.trim();
  if (explicitPlaybackId) return explicitPlaybackId;
  return JSON.stringify({
    animation_id: effect.animation_id,
    target: effect.target,
    target_kind: effect.target_kind,
    target_id: effect.target_id ?? "",
    duration_ms: effect.duration_ms,
    params: stableJsonValue(effect.params),
  });
}

function runtimeTargetKey(effect?: RuntimeAnimationEffect, characterId?: string): string | undefined {
  if (!effect) return undefined;
  return [effect.target_kind, effect.target, effect.target_id ?? "", characterId ?? ""].join("::");
}

function stableJsonValue(value: JsonValue | Record<string, JsonValue> | undefined): unknown {
  if (Array.isArray(value)) return value.map((item) => stableJsonValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item as JsonValue)]),
    );
  }
  return value;
}

export function useRuntimeAnimation(ref: RefObject<HTMLElement | null>, effect?: RuntimeAnimationEffect, characterId?: string): void {
  const effectKey = runtimeEffectKey(effect);
  const playbackKey = runtimePlaybackKey(effect);
  const targetKey = runtimeTargetKey(effect, characterId);
  const animationRef = useRef<Animation | null>(null);
  const startedPlaybackKeyRef = useRef<string | undefined>();
  const stableEffect = useMemo(() => effect, [effectKey]);
  const compiled = useMemo(() => (stableEffect ? compileRuntimeAnimation(stableEffect) : undefined), [stableEffect]);

  useLayoutEffect(() => {
    if (playbackKey && startedPlaybackKeyRef.current === playbackKey && animationRef.current) return undefined;
    if (playbackKey && (hasStartedRuntimePlaybackKey(playbackKey) || activeRuntimePlaybackKeys.has(playbackKey))) {
      if (stableEffect) {
        recordRuntimeAnimationProbe({
          time: performance.now(),
          event: "skipped",
          effect_id: stableEffect.effect_id,
          animation_id: stableEffect.animation_id,
          target: stableEffect.target,
          target_kind: stableEffect.target_kind,
          target_id: stableEffect.target_id,
          character_id: characterId,
          details: { reason: "duplicate-playback-key" },
        });
      }
      return undefined;
    }
    const previousAnimation = animationRef.current;
    animationRef.current = null;
    startedPlaybackKeyRef.current = undefined;
    previousAnimation?.cancel();
    if (!stableEffect || !effectKey || !compiled || !ref.current) {
      if (stableEffect) {
        recordRuntimeAnimationProbe({
          time: performance.now(),
          event: "skipped",
          effect_id: stableEffect.effect_id,
          animation_id: stableEffect.animation_id,
          target: stableEffect.target,
          target_kind: stableEffect.target_kind,
          target_id: stableEffect.target_id,
          character_id: characterId,
          details: { reason: ref.current ? "missing-effect" : "missing-ref" },
        });
      }
      return undefined;
    }
    const activeEffect = stableEffect;
    const activeCompiled = compiled;
    if (prefersReducedMotion()) {
      recordRuntimeAnimationProbe({
        time: performance.now(),
        event: "skipped",
        effect_id: activeEffect.effect_id,
        animation_id: activeEffect.animation_id,
        target: activeEffect.target,
        target_kind: activeEffect.target_kind,
        target_id: activeEffect.target_id,
        character_id: characterId,
        details: { reason: "prefers-reduced-motion" },
      });
      return undefined;
    }
    let frameId: number | undefined;
    let node: HTMLElement | null = null;
    let animation: Animation | null = null;
    let previousTransformOrigin = "";
    let cleaned = false;
    function cleanupAnimation(event: "animate-cleanup" | "animate-cancel") {
      if (cleaned) return;
      cleaned = true;
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
        frameId = undefined;
      }
      if (!animation || !node) return;
      if (animationRef.current === animation) {
        animationRef.current = null;
        startedPlaybackKeyRef.current = undefined;
      }
      if (playbackKey && activeRuntimePlaybackKeys.get(playbackKey) === animation) {
        activeRuntimePlaybackKeys.delete(playbackKey);
      }
      if (targetKey && activeRuntimeTargetAnimations.get(targetKey) === animation) {
        activeRuntimeTargetAnimations.delete(targetKey);
      }
      animation.cancel();
      if (activeCompiled.transformOrigin) node.style.transformOrigin = previousTransformOrigin;
      if (usesTextRenderingLayer(activeEffect)) {
        node.style.transform = "";
        node.style.filter = "";
        node.style.opacity = "";
        node.style.willChange = "";
      }
      recordRuntimeAnimationProbe({
        time: performance.now(),
        event,
        effect_id: activeEffect.effect_id,
        animation_id: activeEffect.animation_id,
        target: activeEffect.target,
        target_kind: activeEffect.target_kind,
        target_id: activeEffect.target_id,
        character_id: characterId,
        active_animations: node.getAnimations().length,
        details: { text_layer: usesTextRenderingLayer(activeEffect), loops: activeCompiled.loops },
      });
    }
    frameId = window.requestAnimationFrame(() => {
      frameId = undefined;
      if (cleaned) return;
      node = ref.current;
      if (!node) {
        recordRuntimeAnimationProbe({
          time: performance.now(),
          event: "skipped",
          effect_id: activeEffect.effect_id,
          animation_id: activeEffect.animation_id,
          target: activeEffect.target,
          target_kind: activeEffect.target_kind,
          target_id: activeEffect.target_id,
          character_id: characterId,
          details: { reason: "missing-ref" },
        });
        return;
      }
      previousTransformOrigin = node.style.transformOrigin;
      if (activeCompiled.transformOrigin) node.style.transformOrigin = activeCompiled.transformOrigin;
      if (targetKey) {
        const previousTargetAnimation = activeRuntimeTargetAnimations.get(targetKey);
        if (previousTargetAnimation && previousTargetAnimation !== animationRef.current) {
          previousTargetAnimation.cancel();
        }
      }
      try {
        animation = node.animate(activeCompiled.keyframes, activeCompiled.options);
      } catch (error) {
        reportFrontendError("player.animation", error, {
          effectId: activeEffect.effect_id,
          animationId: activeEffect.animation_id,
          target: activeEffect.target,
        });
        cleaned = true;
        recordRuntimeAnimationProbe({
          time: performance.now(),
          event: "animate-error",
          effect_id: activeEffect.effect_id,
          animation_id: activeEffect.animation_id,
          target: activeEffect.target,
          target_kind: activeEffect.target_kind,
          target_id: activeEffect.target_id,
          character_id: characterId,
          details: { message: error instanceof Error ? error.message : String(error) },
        });
        return;
      }
      animationRef.current = animation;
      startedPlaybackKeyRef.current = playbackKey;
      if (playbackKey) {
        activeRuntimePlaybackKeys.set(playbackKey, animation);
        rememberStartedRuntimePlaybackKey(playbackKey, activeEffect.duration_ms + 750);
      }
      if (targetKey) {
        activeRuntimeTargetAnimations.set(targetKey, animation);
      }
      recordRuntimeAnimationProbe({
        time: performance.now(),
        event: "animate-start",
        effect_id: activeEffect.effect_id,
        animation_id: activeEffect.animation_id,
        target: activeEffect.target,
        target_kind: activeEffect.target_kind,
        target_id: activeEffect.target_id,
        character_id: characterId,
        active_animations: node.getAnimations().length,
        details: { keyframes: activeCompiled.keyframes.length, options: activeCompiled.options },
      });
      animation.finished
        .then(() => {
          if (!animation || !node) return;
          recordRuntimeAnimationProbe({
            time: performance.now(),
            event: "animate-finish",
            effect_id: activeEffect.effect_id,
            animation_id: activeEffect.animation_id,
            target: activeEffect.target,
            target_kind: activeEffect.target_kind,
            target_id: activeEffect.target_id,
            character_id: characterId,
            active_animations: node.getAnimations().length,
          });
          if (!activeCompiled.loops) cleanupAnimation("animate-cleanup");
        })
        .catch(() => {
          // error-log-ignore: Web Animation 在被新动画接管或组件卸载时会正常拒绝 finished。
          cleanupAnimation("animate-cancel");
        });
    });
    return () => {
      cleanupAnimation("animate-cancel");
    };
  }, [characterId, compiled, effectKey, playbackKey, ref, stableEffect, targetKey]);
}
