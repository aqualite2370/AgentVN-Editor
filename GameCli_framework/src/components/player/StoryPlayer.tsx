import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Check, RotateCw, TriangleAlert } from "lucide-react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { BackgroundLayer } from "./BackgroundLayer";
import { ChoicePanel } from "./ChoicePanel";
import { DialogBox } from "./DialogBox";
import { PlaybackControls } from "./PlaybackControls";
import { SpriteLayer } from "./SpriteLayer";
import { SpriteFocusBackdrop } from "./SpriteFocusBackdrop";
import { FocusedImageOverlay } from "./FocusedImageOverlay";
import { CutsceneVideoOverlay } from "./CutsceneVideoOverlay";
import { CameraWorldLayer } from "./CameraWorldLayer";
import { isSpriteFocusEffect, latestEffect, spriteEffectTargetsCharacter, useRuntimeAnimation } from "./runtimeAnimation";
import { useSettingsStore } from "../../store/settingsStore";
import { sanitizeSpeakerFocus } from "../../../../shared/cartridge/speakerFocus";
import { autoForwardDelayMs } from "../../store/runtimePreferences";
import { RuntimeCustomComponentLayer } from "../../uiSkin/RuntimeCustomComponentLayer";

export function StoryPlayer() {
  const state = useRuntimeStore((store) => store.engineState);
  const currentGame = useRuntimeStore((store) => store.currentGame);
  const next = useRuntimeStore((store) => store.next);
  const engine = useRuntimeStore((store) => store.engine);
  const isUiHidden = useRuntimeStore((store) => store.isUiHidden);
  const setUiHidden = useRuntimeStore((store) => store.setUiHidden);
  const saveNotice = useRuntimeStore((store) => store.saveNotice);
  const settings = useSettingsStore((store) => store.settings);
  const isVoicePlaying = useRuntimeStore((store) => store.isVoicePlaying);
  const spritePresentationMode = useRuntimeStore((store) => store.spritePresentationMode);
  const consumeSpritePresentationMode = useRuntimeStore((store) => store.consumeSpritePresentationMode);
  const [saveNoticeVisible, setSaveNoticeVisible] = useState(false);
  const [quickMenuExpanded, setQuickMenuExpanded] = useState(false);
  const speakerFocus = sanitizeSpeakerFocus(currentGame?.script.speaker_focus);
  const speakingCharacterId = state.dialog && !state.dialog.isNarration ? state.dialog.character_id : undefined;
  const playerRef = useRef<HTMLElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  useRuntimeAnimation(playerRef, latestEffect(state.animationEffects, (effect) => effect.target_kind === "screen"));
  const hidePlayerUi = isUiHidden;
  const interfaceRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const consumeRestoreClickRef = useRef(false);
  const visibleCharacterIds = Object.values(state.sprites).filter((sprite) => sprite.visible).map((sprite) => sprite.character_id);
  const selectedCharacterId = visibleCharacterIds[visibleCharacterIds.length - 1];
  const spriteFocusEffect = latestEffect(state.animationEffects, (effect) => (
    isSpriteFocusEffect(effect) && visibleCharacterIds.some((characterId) => spriteEffectTargetsCharacter(effect, characterId, selectedCharacterId))
  ));
  const collapseQuickMenu = () => setQuickMenuExpanded(false);

  useLayoutEffect(() => {
    if (hidePlayerUi) {
      const focused = document.activeElement;
      returnFocusRef.current = focused instanceof HTMLElement && interfaceRef.current?.contains(focused)
        ? focused : null;
      playerRef.current?.focus({ preventScroll: true });
    } else if (returnFocusRef.current) {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target.isConnected && !document.querySelector("[data-runtime-modal='true']"))
        target.focus({ preventScroll: true });
    }
  }, [hidePlayerUi]);

  useEffect(() => {
    if (spritePresentationMode !== "settle" || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => consumeSpritePresentationMode());
    return () => window.cancelAnimationFrame(frame);
  }, [consumeSpritePresentationMode, spritePresentationMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const resetTransientPlayerUi = () => setQuickMenuExpanded(false);
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") resetTransientPlayerUi();
    };
    window.addEventListener("pageshow", resetTransientPlayerUi);
    window.addEventListener("agentvn:android-resume", resetTransientPlayerUi);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pageshow", resetTransientPlayerUi);
      window.removeEventListener("agentvn:android-resume", resetTransientPlayerUi);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!saveNotice || (saveNotice.kind === "auto" && saveNotice.status !== "error")) {
      setSaveNoticeVisible(false);
      return;
    }
    setSaveNoticeVisible(true);
    if (saveNotice.status === "saving") return;
    const timer = window.setTimeout(() => setSaveNoticeVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

  useEffect(() => {
    if (!settings.selfVoicing || typeof window === "undefined" || !("speechSynthesis" in window) || !state.dialog?.text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      state.dialog.speaker ? `${state.dialog.speaker}。${state.dialog.text}` : state.dialog.text,
    );
    utterance.lang = settings.language;
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
  }, [settings.language, settings.selfVoicing, state.dialog?.speaker, state.dialog?.text, state.dialog?.text_key]);

  useEffect(() => {
    if (
      !state.isAutoMode ||
      hidePlayerUi ||
      state.isTyping ||
      state.isPaused ||
      state.isEnded ||
      state.isWaitingChoice ||
      state.choices.length > 0 ||
      state.focusedImage ||
      state.activeVideo ||
      !state.dialog ||
      (settings.waitForVoice && isVoicePlaying)
    ) {
      return;
    }
    const delay = autoForwardDelayMs(state.dialog.text, settings.autoForwardTime);
    if (delay === undefined) return;
    const timer = window.setTimeout(() => next(true), delay);
    return () => window.clearTimeout(timer);
  }, [
    next,
    hidePlayerUi,
    isVoicePlaying,
    settings.autoForwardTime,
    settings.waitForVoice,
    state.choices.length,
    state.currentCommandIndex,
    state.currentSceneId,
    state.dialog,
    state.focusedImage,
    state.activeVideo,
    state.isAutoMode,
    state.isEnded,
    state.isPaused,
    state.isTyping,
    state.isWaitingChoice,
  ]);

  useEffect(() => {
    if (
      !state.isSkipMode ||
      hidePlayerUi ||
      state.isTyping ||
      state.isPaused ||
      state.isEnded ||
      state.isWaitingChoice ||
      state.choices.length > 0 ||
      state.focusedImage ||
      state.activeVideo ||
      !state.dialog
    ) {
      return;
    }
    const timer = window.setTimeout(() => next(true), 60);
    return () => window.clearTimeout(timer);
  }, [
    next,
    hidePlayerUi,
    state.choices.length,
    state.currentCommandIndex,
    state.currentSceneId,
    state.dialog,
    state.focusedImage,
    state.activeVideo,
    state.isEnded,
    state.isPaused,
    state.isSkipMode,
    state.isTyping,
    state.isWaitingChoice,
  ]);

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    // Consume the restoring gesture from its start: touch compatibility mouse
    // events must not steal focus back from the action restored on pointerup.
    if (hidePlayerUi) event.preventDefault();
    consumeRestoreClickRef.current = false;
    pointerStartRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > 8) return;
    if (state.focusedImage) return;
    if (state.activeVideo) return;
    if (hidePlayerUi) {
      event.preventDefault();
      event.stopPropagation();
      consumeRestoreClickRef.current = true;
      setUiHidden(false);
      return;
    }
    if (state.choices.length > 0 || state.isWaitingChoice) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button,a,input,textarea,select,[role='button'],[data-no-advance],.playback-controls,.choice-panel,.modal-backdrop")) {
      return;
    }
    collapseQuickMenu();
    next();
  }

  return (
    <main
      className={`story-player camera-${state.cameraEffect ?? "none"}${settings.highContrastText ? " preference-high-contrast" : ""}`}
      style={{
        "--runtime-preference-font-scale": String(settings.fontScale),
        "--runtime-preference-line-spacing": String(settings.lineSpacing),
      } as CSSProperties}
      ref={playerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClickCapture={(event) => {
        if (!consumeRestoreClickRef.current) return;
        consumeRestoreClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      tabIndex={-1}
      aria-label="游戏画面"
      data-testid="game-state-playing"
      data-runtime-screen="playing"
      data-playthrough-id={state.playthroughId}
      data-current-scene-id={state.currentSceneId}
      data-current-command-index={state.currentCommandIndex}
      data-current-command-type={state.currentCommandType ?? ""}
      data-is-typing={state.isTyping ? "true" : "false"}
      data-typing-reveal-requested={state.typingRevealRequested ? "true" : "false"}
      data-waiting-choice={state.isWaitingChoice ? "true" : "false"}
      data-ended={state.isEnded ? "true" : "false"}
    >
      <CameraWorldLayer engine={engine} camera={state.camera}>
        <BackgroundLayer
          background={state.background}
          backgroundFit={state.backgroundFit}
          transition={state.backgroundTransition}
          transitionKey={state.backgroundTransitionKey}
          effects={state.animationEffects}
        />
        <SpriteFocusBackdrop effect={spriteFocusEffect} />
        <SpriteLayer
          sprites={state.sprites}
          spriteOrder={state.spriteOrder}
          effects={state.animationEffects}
          focusEffect={spriteFocusEffect}
          speakingCharacterId={speakingCharacterId}
          speakerFocus={speakerFocus}
          presentationMode={spritePresentationMode}
        />
      </CameraWorldLayer>
      {state.animationHint && <div key={state.animationHint} className="animation-hint">{state.animationHint}</div>}
      <div ref={element => {
        interfaceRef.current = element;
        if (element) element.inert = hidePlayerUi || Boolean(state.activeVideo);
      }} className="story-interface" data-testid="story-interface"
        data-hidden={hidePlayerUi ? "true" : "false"}
        aria-hidden={hidePlayerUi || Boolean(state.activeVideo)}>
      {!state.activeVideo && <DialogBox onStoryInteraction={collapseQuickMenu} />}
      {!state.activeVideo && !(state.nvlPresentationMode === "nvl" && state.nvlPage.length > 0) && <ChoicePanel />}
      {!state.activeVideo && (
        <PlaybackControls
          expanded={quickMenuExpanded}
          onToggleExpanded={() => setQuickMenuExpanded((value) => !value)}
        />
      )}
      {!state.activeVideo && <RuntimeCustomComponentLayer screen="player" />}
      </div>
      <FocusedImageOverlay />
      <CutsceneVideoOverlay />
      {saveNotice && saveNoticeVisible && (saveNotice.kind !== "auto" || saveNotice.status === "error") && (
        <div className={`save-status-toast is-${saveNotice.status}`} role="status" aria-live="polite" data-no-advance="true">
          {saveNotice.status === "saving" && <RotateCw size={15} aria-hidden="true" />}
          {saveNotice.status === "saved" && <Check size={15} aria-hidden="true" />}
          {saveNotice.status === "error" && <TriangleAlert size={15} aria-hidden="true" />}
          <span>{saveNotice.message}</span>
        </div>
      )}
    </main>
  );
}
