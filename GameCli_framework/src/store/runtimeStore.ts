import { create } from "zustand";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { StoryEngine, type StoryEngineState } from "../engine/StoryEngine";
import { assetResolver } from "../engine/assetResolver";
import {
  progressiveAssetLoader,
  type AssetPreparationProgress,
} from "../engine/progressiveAssetLoader";
import { deleteDesktopSave, listDesktopSaves, readDesktopSave, writeDesktopSave } from "../engine/desktopSaveManager";
import { captureSavePreview } from "../engine/savePreview";
import { isTextRead, markTextRead } from "../engine/readProgress";
import { useSettingsStore } from "./settingsStore";
import type { RuntimeMode } from "../app/launchConfig";
import type { LibraryGame } from "../types/cartridge";
import type { SaveData, SaveKind, SaveSlotRef } from "../types/save";
import type {
  LivePreviewControlMessage,
  PreviewStartSpec,
} from "../../../shared/preview/livePreviewProtocol";

export type RuntimeScreen =
  | "library"
  | "title_menu"
  | "playing"
  | "save_load"
  | "history"
  | "settings"
  | "main_menu"
  | "gallery"
  | "about";

export type LaunchTransitionPhase = "idle" | "covering" | "revealing";

interface RuntimeStore {
  engine: StoryEngine;
  currentGame?: LibraryGame;
  engineState: StoryEngineState;
  screen: RuntimeScreen;
  returnScreen?: RuntimeScreen;
  runtimeMode: RuntimeMode;
  saves: SaveData[];
  saveNotice?: { status: "saving" | "saved" | "error"; kind: SaveKind; message: string; at: number };
  isUiHidden: boolean;
  skipToggleActive: boolean;
  skipHoldActive: boolean;
  launchTransition: LaunchTransitionPhase;
  launchTransitionDurationMs: number;
  launchPreparation?: AssetPreparationProgress;
  setRuntimeMode: (mode: RuntimeMode) => void;
  loadGame: (game: LibraryGame) => Promise<void>;
  loadLivePreview: (game: LibraryGame, start?: PreviewStartSpec) => void;
  startGame: () => void;
  startNewGame: () => void;
  previewScene: (sceneId: string) => void;
  previewStart: (start: PreviewStartSpec) => void;
  controlLivePreview: (control: Pick<LivePreviewControlMessage, "action" | "playbackRate">) => void;
  continueGame: () => Promise<void>;
  next: () => void;
  completeCurrentTyping: (textKey?: string) => void;
  dismissFocusedImage: () => void;
  completeActiveVideo: () => void;
  choose: (choiceId: string) => void;
  save: (ref: SaveSlotRef) => Promise<void>;
  load: (ref: SaveSlotRef) => Promise<void>;
  deleteSaveSlot: (ref: SaveSlotRef) => Promise<void>;
  flushAutoSave: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  toggleAuto: () => void;
  toggleSkip: () => void;
  disableSkip: () => void;
  setSkipHeld: (active: boolean) => void;
  setUiHidden: (hidden: boolean) => void;
  markCurrentDialogRead: (textKey?: string) => void;
  openHistory: () => void;
  openSaveLoad: () => void;
  openSettings: () => void;
  returnToTitle: () => void;
  openLibrary: () => void;
  openGallery: () => void;
  openAbout: () => void;
  openPreviewScreen: (screen: RuntimeScreen) => void;
}

const engine = new StoryEngine();
const AUTO_SAVE_SLOTS = 8;
const AUTO_SAVE_CHECKPOINTS = 12;
const AUTO_SAVE_MIN_INTERVAL_MS = 30_000;

let playtimeBaseSeconds = 0;
let playtimeStartedAt: number | undefined;
let observedCheckpointSignature: string | undefined;
let lastAutoSaveSignature: string | undefined;
let suppressedCheckpointSignature: string | undefined;
let checkpointsSinceAutoSave = 0;
let lastAutoSaveAt = 0;
let autoSaveQueue: Promise<void> = Promise.resolve();
let lastPrewarmedSceneId = "";

const panelScreens = new Set<RuntimeScreen>(["save_load", "history", "settings", "gallery", "about"]);

function hasPlayableState(engineState: StoryEngineState): boolean {
  return Boolean(engineState.currentSceneId) && !engineState.isEnded;
}

function fallbackMenuScreen(state: Pick<RuntimeStore, "currentGame" | "runtimeMode">): RuntimeScreen {
  if (state.currentGame) return "title_menu";
  return state.runtimeMode === "library" ? "library" : "title_menu";
}

function normalizeReturnScreen(target: RuntimeScreen | undefined, state: RuntimeStore): RuntimeScreen {
  if (!target) return fallbackMenuScreen(state);
  if (target === "playing" && !hasPlayableState(state.engineState)) return fallbackMenuScreen(state);
  if ((target === "title_menu" || target === "main_menu") && !state.currentGame) return fallbackMenuScreen(state);
  return target;
}

function panelReturnScreen(state: RuntimeStore): RuntimeScreen {
  if (panelScreens.has(state.screen)) return state.returnScreen ?? fallbackMenuScreen(state);
  return state.screen;
}

function latestSave(saves: SaveData[]): SaveData | undefined {
  return [...saves].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

function saveKind(save: SaveData): SaveKind {
  return save.save_kind === "auto" ? "auto" : "manual";
}

function stableCheckpointSignature(engineState: StoryEngineState): string | undefined {
  if (!engineState.currentSceneId || engineState.isEnded || engineState.isPaused) return undefined;
  if (!["dialog", "narration", "choice", "show_image"].includes(engineState.currentCommandType ?? "")) return undefined;
  return `${engineState.playthroughId}:${engineState.currentSceneId}:${engineState.currentCommandIndex}:${engineState.currentCommandType}`;
}

function currentPlaytimeSeconds(): number {
  if (!playtimeStartedAt) return Math.max(0, Math.floor(playtimeBaseSeconds));
  return Math.max(0, Math.floor(playtimeBaseSeconds + (Date.now() - playtimeStartedAt) / 1000));
}

function resetPlaytime(baseSeconds = 0): void {
  playtimeBaseSeconds = Math.max(0, baseSeconds);
  playtimeStartedAt = Date.now();
}

function resetAutoSaveTracking(suppressedSignature?: string): void {
  observedCheckpointSignature = suppressedSignature;
  suppressedCheckpointSignature = suppressedSignature;
  lastAutoSaveSignature = suppressedSignature;
  checkpointsSinceAutoSave = 0;
}

function oldestAutoSaveSlot(saves: SaveData[]): SaveSlotRef {
  const autoSaves = saves.filter((save) => saveKind(save) === "auto");
  for (let slot = 1; slot <= AUTO_SAVE_SLOTS; slot += 1) {
    if (!autoSaves.some((save) => save.slot === slot)) return { kind: "auto", slot };
  }
  const oldest = [...autoSaves].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
  return { kind: "auto", slot: oldest?.slot ?? 1 };
}

function progressGameId(state: Pick<RuntimeStore, "currentGame">): string | undefined {
  return state.currentGame?.install_id ?? state.currentGame?.game_id;
}

function canSkipTextKey(state: Pick<RuntimeStore, "currentGame">, textKey?: string): boolean {
  if (!textKey || useSettingsStore.getState().settings.skipUnread) return true;
  return isTextRead(progressGameId(state), textKey);
}

function canCurrentDialogSkip(state: RuntimeStore): boolean {
  return canSkipTextKey(state, state.engineState.dialog?.text_key);
}

function snapshotEngineState(engineState: StoryEngineState): StoryEngineState {
  return {
    ...engineState,
    sprites: { ...engineState.sprites },
    spriteOrder: [...engineState.spriteOrder],
    choices: [...engineState.choices],
    variables: { ...engineState.variables },
    history: [...engineState.history],
    animationEffects: [...engineState.animationEffects],
  };
}

function applySkipFlags(state: RuntimeStore, skipToggleActive: boolean, skipHoldActive: boolean) {
  const requested = skipToggleActive || skipHoldActive;
  const allowed = !requested || canCurrentDialogSkip(state);
  engine.state.isSkipMode = requested && allowed;
  return {
    skipToggleActive: allowed ? skipToggleActive : false,
    skipHoldActive: allowed ? skipHoldActive : false,
    engineState: snapshotEngineState(engine.state),
  };
}

export const useRuntimeStore = create<RuntimeStore>((set, get) => {
  function createSnapshot(ref: SaveSlotRef): SaveData | undefined {
    const installId = get().currentGame?.install_id;
    if (!installId) return undefined;
    const snapshot = engine.createSaveSnapshot(ref.slot);
    snapshot.save_version = 3;
    snapshot.save_kind = ref.kind;
    snapshot.install_id = installId;
    snapshot.game_id = installId;
    snapshot.playtime_seconds = currentPlaytimeSeconds();
    snapshot.preview_choices = engine.state.choices.map((choice) => choice.text);
    return snapshot;
  }

  async function persistSnapshot(ref: SaveSlotRef, snapshot: SaveData): Promise<void> {
    if (get().runtimeMode === "preview") return;
    const installId = snapshot.install_id;
    if (!installId) return;
    set({ saveNotice: { status: "saving", kind: ref.kind, message: ref.kind === "auto" ? "正在自动存档" : "正在保存", at: Date.now() } });
    const preview = await captureSavePreview(snapshot);
    const completed = preview ? { ...snapshot, preview_image: preview } : snapshot;
    await writeDesktopSave(installId, ref, completed);
    const saves = await listDesktopSaves(installId);
    set({
      saves,
      saveNotice: {
        status: "saved",
        kind: ref.kind,
        message: ref.kind === "auto" ? "已自动保存" : "存档已保存",
        at: Date.now(),
      },
    });
  }

  function scheduleAutoSave(engineState: StoryEngineState, force = false): void {
    const settings = useSettingsStore.getState().settings;
    const state = get();
    const signature = stableCheckpointSignature(engineState);
    if (state.runtimeMode === "preview" || !settings.autoSaveEnabled || !state.currentGame || !signature) return;

    if (!force) {
      if (signature === observedCheckpointSignature) return;
      observedCheckpointSignature = signature;
      if (suppressedCheckpointSignature) {
        if (signature === suppressedCheckpointSignature) return;
        suppressedCheckpointSignature = undefined;
        checkpointsSinceAutoSave = 1;
        return;
      }
      checkpointsSinceAutoSave += 1;
    }

    if (signature === lastAutoSaveSignature) return;
    const isChoice = engineState.currentCommandType === "choice";
    if (!force && !isChoice && checkpointsSinceAutoSave < AUTO_SAVE_CHECKPOINTS) return;
    if (Date.now() - lastAutoSaveAt < AUTO_SAVE_MIN_INTERVAL_MS) return;

    const ref = oldestAutoSaveSlot(state.saves);
    const snapshot = createSnapshot(ref);
    if (!snapshot) return;
    lastAutoSaveAt = Date.now();
    lastAutoSaveSignature = signature;
    checkpointsSinceAutoSave = 0;
    autoSaveQueue = autoSaveQueue
      .catch(() => {
        // error-log-ignore: 队列前一项的失败已在它自己的末端处理，这里只保证下一次自动存档仍能执行。
        return undefined;
      })
      .then(() => persistSnapshot(ref, snapshot))
      .catch((error) => {
        lastAutoSaveSignature = undefined;
        set({
          saveNotice: {
            status: "error",
            kind: "auto",
            message: "自动存档失败，将在下一检查点重试",
            at: Date.now(),
          },
        });
        console.error("Auto save failed.", error);
      });
  }

  engine.onChange = (engineState) => {
    set((state) => ({
      engineState: snapshotEngineState(engineState),
      screen: engineState.isEnded && state.screen === "playing" ? "title_menu" : state.screen,
      isUiHidden: state.isUiHidden && !engineState.isWaitingChoice && engineState.choices.length === 0,
    }));
    window.queueMicrotask(() => scheduleAutoSave(engineState));
    if (engineState.currentSceneId && engineState.currentSceneId !== lastPrewarmedSceneId) {
      lastPrewarmedSceneId = engineState.currentSceneId;
      progressiveAssetLoader.warmSuccessors(engineState.currentSceneId);
    }
  };
  engine.canSkipText = (textKey) => canSkipTextKey(get(), textKey);
  engine.onSkipBlocked = () => set({ skipToggleActive: false, skipHoldActive: false });
  return {
    engine,
    engineState: snapshotEngineState(engine.state),
    screen: "library",
    runtimeMode: "library",
    saves: [],
    isUiHidden: false,
    skipToggleActive: false,
    skipHoldActive: false,
    launchTransition: "idle",
    launchTransitionDurationMs: 450,
    setRuntimeMode: (runtimeMode) => set({
      runtimeMode,
      screen: runtimeMode === "library" ? "library" : "title_menu",
      returnScreen: undefined,
      isUiHidden: false,
      skipToggleActive: false,
      skipHoldActive: false,
    }),
    async loadGame(game) {
      assetResolver.configure(game.manifest, "", game.assetUrls);
      progressiveAssetLoader.configure(game);
      engine.loadScript(game.script, game.manifest);
      playtimeStartedAt = undefined;
      playtimeBaseSeconds = 0;
      resetAutoSaveTracking();
      const saves = await listDesktopSaves(game.install_id);
      set({ currentGame: game, engineState: snapshotEngineState(engine.state), saves, screen: "title_menu", returnScreen: undefined, isUiHidden: false, skipToggleActive: false, skipHoldActive: false });
      progressiveAssetLoader.warmEntry();
    },
    loadLivePreview(game, start) {
      assetResolver.configure(game.manifest, "", game.assetUrls);
      progressiveAssetLoader.configure(game);
      engine.loadScript(game.script, game.manifest);
      playtimeStartedAt = undefined;
      playtimeBaseSeconds = 0;
      resetAutoSaveTracking();
      set({
        currentGame: game,
        engineState: snapshotEngineState(engine.state),
        saves: [],
        screen: "title_menu",
        returnScreen: undefined,
        isUiHidden: false,
        skipToggleActive: false,
        skipHoldActive: false,
      });
      if (start) get().previewStart(start);
    },
    startNewGame() {
      if (get().launchTransition !== "idle") return;
      resetPlaytime();
      resetAutoSaveTracking();
      const duration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 80 : 450;
      const preparationStartedAt = performance.now();
      set({
        launchTransition: "covering",
        launchTransitionDurationMs: duration,
        launchPreparation: {
          phase: "entry",
          loadedBytes: 0,
          totalBytes: 0,
          percent: 0,
        },
      });
      void progressiveAssetLoader.prepareEntry(2000, (launchPreparation) => {
        if (get().launchTransition === "covering") set({ launchPreparation });
      }).finally(() => {
        const transitionDelay = Math.max(0, duration - (performance.now() - preparationStartedAt));
        window.setTimeout(() => {
          if (get().launchTransition !== "covering") return;
          engine.start();
          set({
            screen: "playing",
            engineState: snapshotEngineState(engine.state),
            returnScreen: undefined,
            isUiHidden: false,
            launchPreparation: undefined,
          });
          const settleStartedAt = performance.now();
          const revealWhenStable = () => {
            if (get().launchTransition !== "covering") return;
            const engineState = engine.state;
            const stable = Boolean(
              engineState.dialog
              || engineState.focusedImage
              || engineState.activeVideo
              || engineState.isWaitingChoice
              || engineState.isPaused
              || engineState.isEnded
              || engineState.currentCommandType === "wait",
            );
            if (!stable && performance.now() - settleStartedAt < 1000) {
              window.setTimeout(revealWhenStable, 0);
              return;
            }
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                if (get().launchTransition !== "covering") return;
                set({ launchTransition: "revealing" });
                window.setTimeout(() => {
                  if (get().launchTransition === "revealing") {
                    set({ launchTransition: "idle", launchPreparation: undefined });
                  }
                }, duration);
              });
            });
          };
          revealWhenStable();
        }, transitionDelay);
      });
    },
    startGame() {
      get().startNewGame();
    },
    previewScene: (sceneId) => {
      resetPlaytime();
      resetAutoSaveTracking();
      engine.previewScene(sceneId, {
        stopAt: "first_stable_frame",
        suppressTransientEffects: true,
      });
      set({
        screen: "playing",
        engineState: snapshotEngineState(engine.state),
        returnScreen: undefined,
        isUiHidden: false,
        skipToggleActive: false,
        skipHoldActive: false,
      });
    },
    previewStart: (start) => {
      resetPlaytime();
      resetAutoSaveTracking();
      engine.previewStart(start);
      set({
        screen: "playing",
        engineState: snapshotEngineState(engine.state),
        returnScreen: undefined,
        isUiHidden: false,
        skipToggleActive: false,
        skipHoldActive: false,
      });
    },
    controlLivePreview: (control) => {
      engine.controlPreview(control.action, control.playbackRate);
      set({ engineState: snapshotEngineState(engine.state) });
    },
    async continueGame() {
      const save = latestSave(get().saves);
      if (!save) return;
      await get().load({ kind: saveKind(save), slot: save.slot });
    },
    next: () => {
      engine.next();
      set({ engineState: snapshotEngineState(engine.state) });
    },
    completeCurrentTyping: (textKey) => {
      engine.completeTyping(textKey);
      set({ engineState: snapshotEngineState(engine.state) });
    },
    dismissFocusedImage: () => {
      const before = {
        hasFocusedImage: Boolean(engine.state.focusedImage),
        sceneId: engine.state.currentSceneId,
        commandIndex: engine.state.currentCommandIndex,
      };
      engine.dismissFocusedImage();
      const host = window as Window & { __AGENTVN_FOCUSED_IMAGE_LOG__?: Array<Record<string, unknown>> };
      host.__AGENTVN_FOCUSED_IMAGE_LOG__ = [
        ...(host.__AGENTVN_FOCUSED_IMAGE_LOG__ ?? []),
        {
          event: "store-dismiss-complete",
          at: performance.now(),
          before,
          after: {
            hasFocusedImage: Boolean(engine.state.focusedImage),
            sceneId: engine.state.currentSceneId,
            commandIndex: engine.state.currentCommandIndex,
          },
        },
      ].slice(-100);
      set({ engineState: snapshotEngineState(engine.state) });
    },
    completeActiveVideo: () => {
      engine.completeActiveVideo();
      set({ engineState: snapshotEngineState(engine.state) });
    },
    choose: (choiceId) => {
      engine.choose(choiceId);
      set({ engineState: snapshotEngineState(engine.state), isUiHidden: false });
    },
    async save(ref) {
      if (get().runtimeMode === "preview") return;
      const snapshot = createSnapshot(ref);
      if (!snapshot) return;
      try {
        await persistSnapshot(ref, snapshot);
      } catch (error) {
        reportFrontendError("player.save", error, { kind: ref.kind, slot: ref.slot });
        set({ saveNotice: { status: "error", kind: ref.kind, message: "存档写入失败", at: Date.now() } });
        throw error;
      }
    },
    async load(ref) {
      const installId = get().currentGame?.install_id;
      if (!installId) return;
      const save = await readDesktopSave(installId, ref);
      if (!save) return;
      resetPlaytime(save.playtime_seconds);
      resetAutoSaveTracking(`${save.scene_id}:${save.command_index}:${engine.state.currentCommandType ?? ""}`);
      engine.restoreSaveSnapshot(save);
      resetAutoSaveTracking(stableCheckpointSignature(engine.state));
      set({ screen: "playing", engineState: snapshotEngineState(engine.state), saves: await listDesktopSaves(installId), returnScreen: undefined, isUiHidden: false });
    },
    async deleteSaveSlot(ref) {
      const installId = get().currentGame?.install_id;
      if (!installId) return;
      await deleteDesktopSave(installId, ref);
      set({ saves: await listDesktopSaves(installId) });
    },
    flushAutoSave: () => {
      if (get().runtimeMode !== "preview") scheduleAutoSave(engine.state, true);
    },
    openMenu: () => set((state) => ({
      screen: state.currentGame && hasPlayableState(state.engineState) ? "main_menu" : fallbackMenuScreen(state),
      returnScreen: undefined,
      isUiHidden: false,
    })),
    closeMenu: () => set((state) => ({
      screen: normalizeReturnScreen(state.returnScreen ?? (hasPlayableState(state.engineState) ? "playing" : undefined), state),
      returnScreen: undefined,
      isUiHidden: false,
    })),
    toggleAuto: () => {
      engine.state.isAutoMode = !engine.state.isAutoMode;
      engine.onChange?.(engine.state);
    },
    toggleSkip: () => set((state) => applySkipFlags(state, !state.skipToggleActive, state.skipHoldActive)),
    disableSkip: () => {
      engine.state.isSkipMode = false;
      set({ skipToggleActive: false, skipHoldActive: false, engineState: snapshotEngineState(engine.state) });
    },
    setSkipHeld: (active) => set((state) => applySkipFlags(state, state.skipToggleActive, active)),
    setUiHidden: (hidden) => set((state) => ({
      isUiHidden: hidden && state.screen === "playing" && state.engineState.choices.length === 0 && !state.engineState.isWaitingChoice,
    })),
    markCurrentDialogRead: (textKey) => {
      const state = get();
      markTextRead(progressGameId(state), textKey ?? state.engineState.dialog?.text_key);
    },
    openHistory: () => set((state) => ({ screen: "history", returnScreen: panelReturnScreen(state), isUiHidden: false })),
    openSaveLoad: () => {
      if (get().runtimeMode === "preview") return;
      set((state) => ({ screen: "save_load", returnScreen: panelReturnScreen(state), isUiHidden: false }));
    },
    openSettings: () => set((state) => ({ screen: "settings", returnScreen: panelReturnScreen(state), isUiHidden: false })),
    returnToTitle: () => {
      get().flushAutoSave();
      set((state) => ({ screen: fallbackMenuScreen({ currentGame: state.currentGame, runtimeMode: state.runtimeMode }), returnScreen: undefined, isUiHidden: false }));
    },
    openLibrary: () => set((state) => ({ screen: state.runtimeMode === "library" ? "library" : fallbackMenuScreen(state), returnScreen: undefined, isUiHidden: false })),
    openGallery: () => set((state) => ({ screen: "gallery", returnScreen: panelReturnScreen(state), isUiHidden: false })),
    openAbout: () => set((state) => ({ screen: "about", returnScreen: panelReturnScreen(state), isUiHidden: false })),
    openPreviewScreen: (screen) => set((state) => {
      if (!state.currentGame && screen !== "library") return state;
      if (screen === "playing" && !hasPlayableState(state.engineState)) {
        engine.start();
        return { screen: "playing", engineState: snapshotEngineState(engine.state), returnScreen: undefined, isUiHidden: false, launchTransition: "idle" };
      }
      return { screen, returnScreen: undefined, isUiHidden: false };
    })
  };
});

engine.setCameraSuspended("system-ui", true);

useRuntimeStore.subscribe((state, previous) => {
  if (state.screen === previous.screen) return;
  engine.setCameraSuspended("system-ui", state.screen !== "playing");
});

if (typeof document !== "undefined") {
  const syncDocumentVisibility = () => {
    engine.setCameraSuspended("document-hidden", document.visibilityState !== "visible");
  };
  document.addEventListener("visibilitychange", syncDocumentVisibility);
  syncDocumentVisibility();
}
