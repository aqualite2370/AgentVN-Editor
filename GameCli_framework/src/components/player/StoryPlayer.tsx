import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Check, RotateCw, TriangleAlert } from "lucide-react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { BackgroundLayer } from "./BackgroundLayer";
import { ChoicePanel } from "./ChoicePanel";
import { DialogBox } from "./DialogBox";
import { PlaybackControls } from "./PlaybackControls";
import { RuntimeAudio } from "./RuntimeAudio";
import { SpriteLayer } from "./SpriteLayer";
import { SpriteFocusBackdrop } from "./SpriteFocusBackdrop";
import { FocusedImageOverlay } from "./FocusedImageOverlay";
import { CutsceneVideoOverlay } from "./CutsceneVideoOverlay";
import { CameraWorldLayer } from "./CameraWorldLayer";
import { isSpriteFocusEffect, latestEffect, spriteEffectTargetsCharacter, useRuntimeAnimation } from "./runtimeAnimation";
import { useSettingsStore } from "../../store/settingsStore";
import { sanitizeSpeakerFocus } from "../../../../shared/cartridge/speakerFocus";

export function StoryPlayer() {
  const state = useRuntimeStore((store) => store.engineState);
  const currentGame = useRuntimeStore((store) => store.currentGame);
  const next = useRuntimeStore((store) => store.next);
  const engine = useRuntimeStore((store) => store.engine);
  const isUiHidden = useRuntimeStore((store) => store.isUiHidden);
  const setUiHidden = useRuntimeStore((store) => store.setUiHidden);
  const launchTransition = useRuntimeStore((store) => store.launchTransition);
  const saveNotice = useRuntimeStore((store) => store.saveNotice);
  const settings = useSettingsStore((store) => store.settings);
  const [saveNoticeVisible, setSaveNoticeVisible] = useState(false);
  const speakerFocus = sanitizeSpeakerFocus(currentGame?.script.speaker_focus);
  const speakingCharacterId = state.dialog && !state.dialog.isNarration ? state.dialog.character_id : undefined;
  const playerRef = useRef<HTMLElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  useRuntimeAnimation(playerRef, latestEffect(state.animationEffects, (effect) => effect.target_kind === "screen"));
  const hidePlayerUi = isUiHidden && state.choices.length === 0 && !state.isWaitingChoice;
  const visibleCharacterIds = Object.values(state.sprites).filter((sprite) => sprite.visible).map((sprite) => sprite.character_id);
  const selectedCharacterId = visibleCharacterIds[visibleCharacterIds.length - 1];
  const spriteFocusEffect = latestEffect(state.animationEffects, (effect) => (
    isSpriteFocusEffect(effect) && visibleCharacterIds.some((characterId) => spriteEffectTargetsCharacter(effect, characterId, selectedCharacterId))
  ));

  useEffect(() => {
    if (!saveNotice) return;
    setSaveNoticeVisible(true);
    if (saveNotice.status === "saving") return;
    const timer = window.setTimeout(() => setSaveNoticeVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

  useEffect(() => {
    if (
      !state.isAutoMode ||
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
    const timer = window.setTimeout(() => next(), settings.autoSpeed);
    return () => window.clearTimeout(timer);
  }, [
    next,
    settings.autoSpeed,
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
    const timer = window.setTimeout(() => next(), 60);
    return () => window.clearTimeout(timer);
  }, [
    next,
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
      setUiHidden(false);
      return;
    }
    if (state.choices.length > 0 || state.isWaitingChoice) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button,a,input,textarea,select,[role='button'],[data-no-advance],.playback-controls,.choice-panel,.modal-backdrop")) {
      return;
    }
    next();
  }

  return (
    <main
      className={`story-player camera-${state.cameraEffect ?? "none"}${launchTransition === "covering" ? " is-launch-covered" : ""}`}
      ref={playerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
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
          key={state.playthroughId + ":" + state.currentSceneId}
          sprites={state.sprites}
          spriteOrder={state.spriteOrder}
          effects={state.animationEffects}
          focusEffect={spriteFocusEffect}
          speakingCharacterId={speakingCharacterId}
          speakerFocus={speakerFocus}
        />
      </CameraWorldLayer>
      <RuntimeAudio />
      {state.animationHint && <div key={state.animationHint} className="animation-hint">{state.animationHint}</div>}
      {!hidePlayerUi && !state.activeVideo && <DialogBox />}
      {!state.activeVideo && <ChoicePanel />}
      {!hidePlayerUi && !state.activeVideo && <PlaybackControls />}
      <FocusedImageOverlay />
      <CutsceneVideoOverlay />
      {saveNotice && saveNoticeVisible && (
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
