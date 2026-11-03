import { create } from "zustand";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { StoryEngine, type StoryEngineState, type PlaybackSessionCheckpoint } from "../engine/StoryEngine";
import { assetResolver } from "../engine/assetResolver";
import {
  progressiveAssetLoader,
  type AssetPreparationProgress,
} from "../engine/progressiveAssetLoader";
import { deleteDesktopSave, getSaveStorageInfo, listDesktopSaves, migrateLegacySaves, readDesktopSave, writeDesktopSave,
  type SaveStorageInfo } from "../engine/desktopSaveManager";
import {
  SAVE_PREVIEW_VERSION,
  cacheCurrentSavePreview,
  captureCurrentSavePreview,
  captureSavePreview,
  clearCachedSavePreview,
  renderSavePreviewFromState,
} from "../engine/savePreview";
import { validateSaveData } from "../engine/validation";
import { isTextRead, markTextRead } from "../engine/readProgress";
import { createSerialSaveQueue, createSaveWriteBarrier } from "../utils/runtimeSaveQueue";
import { chooseQuickSaveSlot, expiredQuickSaves, latestQuickSave } from "../utils/quickSavePolicy";
import {
  listGalleryUnlocks,
  readGalleryAnchor,
  writeGalleryAnchor,
  type GalleryUnlockRecord,
} from "../engine/galleryAnchorManager";
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
  | "about"
  | "help";

export interface PendingRuntimeScreenNavigation {
  id: number;
  fromScreen: RuntimeScreen;
  toScreen: RuntimeScreen;
  returnScreen: RuntimeScreen | undefined;
}

export type GameEntryIntent =
  | { kind: "new_game" }
  | { kind: "resume_active" }
  | { kind: "continue_latest" }
  | { kind: "load_slot"; ref: SaveSlotRef }
  | { kind: "gallery_anchor"; anchorId: string }
  | { kind: "preview_scene"; sceneId: string }
  | { kind: "preview_start" };

export type GameEntryPhase = "idle" | "arming" | "covering" | "preparing" | "revealing";
export type GameEntryIntentKind = GameEntryIntent["kind"];
export type RuntimeAutoSaveResult =
  | { status: "saved" }
  | { status: "skipped"; reason: "preview" | "disabled" | "no_game" | "no_checkpoint" | "unchanged" | "gallery_replay" }
  | { status: "failed"; message: string };

interface RuntimeStore {
  engine: StoryEngine;
  currentGame?: LibraryGame;
  engineState: StoryEngineState;
  screen: RuntimeScreen;
  pendingScreenNavigation?: PendingRuntimeScreenNavigation;
  returnScreen?: RuntimeScreen;
  exitConfirmationOpen: boolean;
  runtimeMode: RuntimeMode;
  presentationMode: "development" | "release";
  saves: SaveData[];
  quickSavePending: boolean;
  saveStorageInfo?: SaveStorageInfo;
  saveMigrationOpen: boolean;
  saveMigrationPending: boolean;
  saveMigrationError?: string;
  openSaveMigration: () => Promise<void>;
  closeSaveMigration: () => void;
  confirmSaveMigration: () => Promise<void>;
  quickLoadCandidate?: SaveData;
  saveNotice?: { status: "saving" | "saved" | "error"; kind: SaveKind; message: string; at: number };
  isVoicePlaying: boolean;
  isUiHidden: boolean;
  skipToggleActive: boolean;
  skipHoldActive: boolean;
  launchTransition: GameEntryPhase;
  launchTransitionId: number;
  launchIntent?: GameEntryIntent;
  launchTransitionDurationMs: number;
  launchPreparation?: AssetPreparationProgress;
  entryError?: string;
  galleryUnlocks: string[];
  galleryNotice?: string;
  galleryReplayActive: boolean;
  galleryReturnSnapshot?: SaveData;
  galleryReplayReturnScreen?: RuntimeScreen;
  galleryReturnSession?: PlaybackSessionCheckpoint;
  spritePresentationMode: "animate" | "settle";
  setRuntimeMode: (mode: RuntimeMode) => void;
  setPresentationMode: (mode: "development" | "release") => void;
  loadGame: (game: LibraryGame) => Promise<void>;
  loadLivePreview: (game: LibraryGame, start?: PreviewStartSpec) => Promise<void>;
  updateLivePreviewAppearance: (game: Pick<LibraryGame, "game_id" | "manifest" | "uiSkin" | "assetUrls">) => void;
  startGame: () => Promise<void>;
  startNewGame: () => Promise<void>;
  previewScene: (sceneId: string) => Promise<void>;
  previewStart: (start: PreviewStartSpec) => Promise<void>;
  controlLivePreview: (control: Pick<LivePreviewControlMessage, "action" | "playbackRate">) => void;
  continueGame: () => Promise<void>;
  resumeActiveGame: () => Promise<void>;
  next: (automatic?: boolean) => void;
  setDialogPagePosition: (pageIndex: number, pageCount: number) => void;
  rollback: () => boolean;
  rollForward: () => boolean;
  completeCurrentTyping: (textKey?: string) => void;
  dismissFocusedImage: () => void;
  completeActiveVideo: () => void;
  choose: (choiceId: string) => void;
  save: (ref: SaveSlotRef) => Promise<void>;
  quickSave: () => Promise<void>;
  requestQuickLoad: () => void;
  cancelQuickLoad: () => void;
  confirmQuickLoad: () => Promise<void>;
  load: (ref: SaveSlotRef) => Promise<void>;
  deleteSaveSlot: (ref: SaveSlotRef) => Promise<void>;
  upgradeSavePreviews: () => Promise<void>;
  flushAutoSave: () => Promise<RuntimeAutoSaveResult>;
  openMenu: () => void;
  closeMenu: () => void;
  toggleAuto: () => void;
  toggleSkip: () => void;
  disableSkip: () => void;
  setSkipHeld: (active: boolean) => void;
  setUiHidden: (hidden: boolean) => void;
  setVoicePlaying: (playing: boolean) => void;
  markCurrentDialogRead: (textKey?: string) => void;
  openHistory: () => void;
  openSaveLoad: () => Promise<void>;
  openSettings: () => void;
  returnToTitle: () => void;
  openLibrary: () => void;
  openGallery: () => void;
  openGalleryAnchor: (anchorId: string) => Promise<void>;
  exitGalleryReplay: () => void;
  openAbout: () => void;
  openHelp: () => void;
  openExitConfirmation: () => void;
  closeExitConfirmation: () => void;
  openPreviewScreen: (screen: RuntimeScreen) => void;
  commitScreenNavigation: (id: number) => void;
  cancelScreenNavigation: (id: number) => void;
  beginLaunchCover: () => void;
  completeLaunchCover: () => Promise<void>;
  completeLaunchReveal: () => void;
  consumeSpritePresentationMode: () => void;
}

  const engine = new StoryEngine();
export const RUNTIME_BLACKOUT_COVER_DURATION_MS = 748;
export const RUNTIME_BLACKOUT_REVEAL_DURATION_MS = 884;
export const RUNTIME_BLACKOUT_REDUCED_DURATION_MS = 408;
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
const autoSaveQueue = createSerialSaveQueue<RuntimeAutoSaveResult>();
let previewUpgradePromise: Promise<void> | undefined;
let lastPrewarmedSceneId = "";
let launchRequestCounter = 0;
let screenNavigationRequestCounter = 0;
const launchCompletionResolvers = new Map<number, () => void>();

const panelScreens = new Set<RuntimeScreen>(["save_load", "history", "settings", "gallery", "about", "help"]);

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

function saveKind(save: SaveData): SaveKind {
  return save.save_kind === "auto" || save.save_kind === "quick" ? save.save_kind : "manual";
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

function waitForFrames(count: number): Promise<void> {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = Math.max(0, count);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
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

function launchCoverDurationMs(): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? RUNTIME_BLACKOUT_REDUCED_DURATION_MS
    : RUNTIME_BLACKOUT_COVER_DURATION_MS;
}

function launchRevealDurationMs(): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? RUNTIME_BLACKOUT_REDUCED_DURATION_MS
    : RUNTIME_BLACKOUT_REVEAL_DURATION_MS;
}

export const useRuntimeStore = create<RuntimeStore>((set, get) => {
  type PreparedLaunch = {
    kind: GameEntryIntentKind;
    save?: SaveData;
    gallerySave?: SaveData;
    gallerySceneId?: string;
    saves?: SaveData[];
    previewSceneId?: string;
    previewStart?: PreviewStartSpec;
  };

  const launchTasks = new Map<number, Promise<PreparedLaunch>>();
  const saveWrites = createSaveWriteBarrier();
  const saveQueue = createSerialSaveQueue<void>();
  let saveOwner = 0;
  let quickWrite: { owner: number; promise: Promise<void> } | undefined;
  let confirmingQuickLoad = false;
  // Temporary presentation state, deliberately outside save snapshots/settings.
  let hiddenPlayback: { playthroughId: number; auto: boolean; toggle: boolean; hold: boolean } | undefined;

  function requestScreenNavigation(
    toScreen: RuntimeScreen,
    returnScreen: RuntimeScreen | undefined,
  ): void {
    // Revealing already exposes interactive player controls. Finish that
    // visual phase before navigating, otherwise their first click is lost.
    if (get().launchTransition === "revealing") get().completeLaunchReveal();
    const state = get();
    if (state.launchTransition !== "idle") return;
    if (state.pendingScreenNavigation?.toScreen === toScreen) return;
    if (state.screen === toScreen && !state.pendingScreenNavigation) {
      set({ returnScreen, isUiHidden: false });
      return;
    }
    set({
      pendingScreenNavigation: {
        id: ++screenNavigationRequestCounter,
        fromScreen: state.screen,
        toScreen,
        returnScreen,
      },
      isUiHidden: false,
    });
  }

  function createSnapshot(ref: SaveSlotRef): SaveData | undefined {
    const state = get();
    if (state.galleryReplayActive) return undefined;
    const installId = state.currentGame?.install_id;
    if (!installId) return undefined;
    const snapshot = engine.createSaveSnapshot(ref.slot);
    snapshot.save_version = 3;
    snapshot.save_kind = ref.kind;
    snapshot.install_id = installId;
    // Fixed exports share an install ID, not a game identity. Native portable
    // storage validates the latter; keep the former solely as the storage key.
    // Library/preview identities and legacy-read compatibility remain unchanged.
    snapshot.game_id = state.runtimeMode === "fixed" ? state.currentGame!.game_id : installId;
    snapshot.playtime_seconds = currentPlaytimeSeconds();
    snapshot.preview_choices = engine.state.choices.map((choice) => choice.text);
    return snapshot;
  }

  function saveCompatibilityError(save: SaveData): string | undefined {
    const state = get();
    const game = state.currentGame;
    if (!game) return "当前还没有载入卡带。";
    const structuralIssues = validateSaveData(save);
    if (structuralIssues.length > 0) return structuralIssues[0].message;
    if (save.game_id && save.game_id !== game.game_id && save.game_id !== game.install_id) {
      return "这个存档不属于当前卡带。";
    }
    const scene = engine.getScene(save.scene_id);
    if (!scene) return `存档指向的场景不存在：${save.scene_id}`;
    const maxCommandIndex = save.gallery_anchor_id ? scene.commands.length : scene.commands.length - 1;
    if (!Number.isInteger(save.command_index) || save.command_index < 0 || save.command_index > maxCommandIndex) {
      return `存档指向的剧情位置无效：${scene.title || scene.scene_id}。`;
    }
    return undefined;
  }

  function latestCompatibleSave(saves: SaveData[]): SaveData | undefined {
    return [...saves]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .find((save) => !saveCompatibilityError(save));
  }

  function updateLaunchProgress(id: number, progress: AssetPreparationProgress): void {
    if (get().launchTransitionId !== id || get().launchTransition === "idle") return;
    set({ launchPreparation: progress });
  }

  function beginLaunch(
    intent: GameEntryIntent,
    operation: (id: number) => Promise<PreparedLaunch>,
  ): Promise<void> {
    if (get().launchTransition !== "idle") return Promise.resolve();
    const id = ++launchRequestCounter;
    const completion = new Promise<void>((resolve) => {
      launchCompletionResolvers.set(id, resolve);
    });
    set({
      launchTransition: "arming",
      launchTransitionId: id,
      launchIntent: intent,
      launchTransitionDurationMs: launchCoverDurationMs(),
      pendingScreenNavigation: undefined,
      launchPreparation: {
        phase: intent.kind === "new_game" ? "entry" : "scene",
        loadedBytes: 0,
        totalBytes: 0,
        percent: 0,
      },
      entryError: undefined,
    });
    const task = operation(id);
    launchTasks.set(id, task);
    void task.catch(() => undefined);
    return completion;
  }

  async function prepareSaveLaunch(
    id: number,
    ref: SaveSlotRef,
    kind: GameEntryIntentKind,
  ): Promise<PreparedLaunch> {
    const installId = get().currentGame?.install_id;
    if (!installId) throw new Error("当前还没有载入卡带。");
    const save = await readDesktopSave(installId, ref);
    if (!save) throw new Error("找不到这个存档，可能已被删除。");
    const compatibilityError = saveCompatibilityError(save);
    if (compatibilityError) throw new Error(compatibilityError);
    const ready = await progressiveAssetLoader.prepareScene(
      save.scene_id,
      10_000,
      (progress) => updateLaunchProgress(id, progress),
    );
    if (!ready) throw new Error("存档目标场景资源准备超时，请稍后重试。");
    return {
      kind,
      save,
      saves: await listDesktopSaves(installId),
    };
  }

  async function prepareGalleryLaunch(
    id: number,
    anchorId: string,
  ): Promise<PreparedLaunch> {
    const game = get().currentGame;
    const item = game?.gallery.find((candidate) => (
      candidate.anchor_id === anchorId || candidate.item_id === anchorId
    ));
    if (item?.scene_id) {
      const ready = await progressiveAssetLoader.prepareScene(
        item.scene_id,
        10_000,
        (progress) => updateLaunchProgress(id, progress),
      );
      if (!ready) throw new Error("画廊回放场景资源准备超时，请稍后重试。");
      return { kind: "gallery_anchor", gallerySceneId: item.scene_id };
    }

    const installId = game?.install_id;
    if (!installId) throw new Error("当前还没有载入卡带。");
    const record = await readGalleryAnchor(installId, anchorId);
    if (!record) throw new Error("找不到这个画廊锚点的回看记录。");
    if (isGalleryUnlockRecord(record)) {
      const ready = await progressiveAssetLoader.prepareScene(
        record.scene_id,
        10_000,
        (progress) => updateLaunchProgress(id, progress),
      );
      if (!ready) throw new Error("画廊回放场景资源准备超时，请稍后重试。");
      return { kind: "gallery_anchor", gallerySceneId: record.scene_id };
    }
    const save = record;
    const compatibilityError = saveCompatibilityError(save);
    if (compatibilityError) throw new Error(compatibilityError);
    const ready = await progressiveAssetLoader.prepareScene(
      save.scene_id,
      10_000,
      (progress) => updateLaunchProgress(id, progress),
    );
    if (!ready) throw new Error("画廊锚点目标场景资源准备超时，请稍后重试。");
    return { kind: "gallery_anchor", gallerySave: save };
  }

  function isGalleryUnlockRecord(record: SaveData | GalleryUnlockRecord): record is GalleryUnlockRecord {
    return "anchor_id" in record && "unlocked_at" in record && "scene_id" in record;
  }

  async function persistSnapshot(
    ref: SaveSlotRef,
    snapshot: SaveData,
    preferredPreview?: string,
  ): Promise<void> {
    const owner = saveOwner;
    const ownsUI = () => owner === saveOwner && get().currentGame?.install_id === snapshot.install_id;
    await saveWrites.track(() => saveQueue.enqueue(async () => {
      const installId = snapshot.install_id;
      if (!installId) return;
      if (ownsUI()) set({ saveNotice: { status: "saving", kind: ref.kind,
        message: ref.kind === "auto" ? "正在自动存档" : ref.kind === "quick" ? "正在快速保存" : "正在保存", at: Date.now() } });
      const preview = await captureSavePreview(snapshot, preferredPreview);
      const completed: SaveData = preview
        ? { ...snapshot, preview_image: preview, preview_version: SAVE_PREVIEW_VERSION }
        : snapshot;
      await writeDesktopSave(installId, ref, completed);
      if (ref.kind === "quick") {
        const persisted = await listDesktopSaves(installId);
        for (const expired of expiredQuickSaves(persisted)) {
          await deleteDesktopSave(installId, { kind: "quick", slot: expired.slot });
        }
      }
      const saves = await listDesktopSaves(installId);
      if (ownsUI()) set({
        saves,
        saveNotice: {
          status: "saved",
          kind: ref.kind,
          message: ref.kind === "auto" ? "已自动保存" : ref.kind === "quick" ? "快存已保存" : "存档已保存",
          at: Date.now(),
        },
      });
    }));
  }

  function scheduleAutoSave(engineState: StoryEngineState, force = false): Promise<RuntimeAutoSaveResult> {
    const settings = useSettingsStore.getState().settings;
    const state = get();
    const signature = stableCheckpointSignature(engineState);
    if (state.galleryReplayActive || engineState.isGalleryReplay) {
      return Promise.resolve({ status: "skipped", reason: "gallery_replay" });
    }
    if (state.runtimeMode === "preview") return Promise.resolve({ status: "skipped", reason: "preview" });
    if (!settings.autoSaveEnabled) return Promise.resolve({ status: "skipped", reason: "disabled" });
    if (!state.currentGame) return Promise.resolve({ status: "skipped", reason: "no_game" });
    if (!signature) return Promise.resolve({ status: "skipped", reason: "no_checkpoint" });

    if (!force) {
      if (signature === observedCheckpointSignature) {
        return Promise.resolve({ status: "skipped", reason: "unchanged" });
      }
      observedCheckpointSignature = signature;
      if (suppressedCheckpointSignature) {
        if (signature === suppressedCheckpointSignature) {
          return Promise.resolve({ status: "skipped", reason: "unchanged" });
        }
        suppressedCheckpointSignature = undefined;
        checkpointsSinceAutoSave = 1;
        return Promise.resolve({ status: "skipped", reason: "unchanged" });
      }
      checkpointsSinceAutoSave += 1;
    }

    // Restoring any save suppresses routine autosaves for that checkpoint.
    // An explicit exit flush must still persist the current state: that
    // restored checkpoint may exist only as a quick/manual save, and revisiting
    // the same scene/command can carry different history or variables.
    if (!force && signature === lastAutoSaveSignature) return Promise.resolve({ status: "skipped", reason: "unchanged" });
    const isChoice = engineState.currentCommandType === "choice";
    if (!force && !isChoice && checkpointsSinceAutoSave < AUTO_SAVE_CHECKPOINTS) {
      return Promise.resolve({ status: "skipped", reason: "unchanged" });
    }
    if (!force && Date.now() - lastAutoSaveAt < AUTO_SAVE_MIN_INTERVAL_MS) {
      return Promise.resolve({ status: "skipped", reason: "unchanged" });
    }

    const ref = oldestAutoSaveSlot(state.saves);
    const snapshot = createSnapshot(ref);
    if (!snapshot) return Promise.resolve({ status: "skipped", reason: "no_checkpoint" });
    const previewPromise = captureCurrentSavePreview(snapshot);
    lastAutoSaveAt = Date.now();
    lastAutoSaveSignature = signature;
    checkpointsSinceAutoSave = 0;
    return autoSaveQueue.enqueue(async () => {
      try {
        await persistSnapshot(ref, snapshot, await previewPromise);
        return { status: "saved" };
      } catch (error) {
        lastAutoSaveSignature = undefined;
        const message = error instanceof Error ? error.message : String(error);
        set({
          saveNotice: {
            status: "error",
            kind: "auto",
            message: "自动存档失败，将在下一检查点重试",
            at: Date.now(),
          },
        });
        console.error("Auto save failed.", error);
        return { status: "failed", message };
      }
    });
  }

  function finishGalleryReplay(): void {
    const state = get();
    if (!state.galleryReplayActive) return;
    const returnSnapshot = state.galleryReturnSnapshot;
    const returnScreen = state.galleryReplayReturnScreen;
    set({ galleryReplayActive: false });
    if (returnSnapshot) {
      resetPlaytime(returnSnapshot.playtime_seconds);
      if (state.galleryReturnSession) {
        if (!state.galleryReturnSession.restore()) engine.reset();
      } else engine.restoreSaveSnapshot(returnSnapshot);
    } else {
      engine.reset();
      playtimeStartedAt = undefined;
      playtimeBaseSeconds = 0;
    }
    resetAutoSaveTracking(stableCheckpointSignature(engine.state));
    set({
      engineState: snapshotEngineState(engine.state),
      galleryReplayActive: false,
      galleryReturnSnapshot: undefined,
      galleryReplayReturnScreen: undefined,
      galleryReturnSession: undefined,
      isUiHidden: false,
      skipToggleActive: false,
      skipHoldActive: false,
    });
    requestScreenNavigation("gallery", returnScreen);
  }

  engine.onChange = (engineState) => {
    if (engineState.isEnded && get().galleryReplayActive) {
      finishGalleryReplay();
      return;
    }
    const state = get();
    if (hiddenPlayback && hiddenPlayback.playthroughId !== engineState.playthroughId) hiddenPlayback = undefined;
    const shouldReturnToTitle = engineState.isEnded && state.screen === "playing";
    set({
      engineState: snapshotEngineState(engineState),
    });
    if (shouldReturnToTitle) requestScreenNavigation("title_menu", undefined);
    window.queueMicrotask(() => scheduleAutoSave(engineState));
    if (engineState.currentSceneId && engineState.currentSceneId !== lastPrewarmedSceneId) {
      lastPrewarmedSceneId = engineState.currentSceneId;
      progressiveAssetLoader.warmSuccessors(engineState.currentSceneId);
    }
  };
  engine.onGalleryAnchor = (command, snapshot) => {
    const state = get();
    const installId = state.currentGame?.install_id;
    if (
      !installId
      || installId === "preview_gamecli"
      || state.galleryReplayActive
      || engine.state.isGalleryReplay
      || state.galleryUnlocks.includes(command.anchor_id)
    ) return;
    const persisted = {
      anchor_id: command.anchor_id,
      scene_id: snapshot.scene_id,
      unlocked_at: new Date().toISOString(),
    };
    void writeGalleryAnchor(installId, command.anchor_id, persisted)
      .then(() => {
        set((current) => ({
          galleryUnlocks: current.galleryUnlocks.includes(command.anchor_id)
            ? current.galleryUnlocks
            : [...current.galleryUnlocks, command.anchor_id],
          currentGame: current.currentGame
            ? {
                ...current.currentGame,
                gallery: current.currentGame.gallery.map((item) => (
                  item.anchor_id === command.anchor_id || item.item_id === command.anchor_id
                    ? { ...item, unlocked: true }
                    : item
                )),
              }
            : current.currentGame,
          galleryNotice: `已解锁画廊-${command.title}`,
          saveNotice: { status: "saved", kind: "manual", message: `已解锁画廊-${command.title}`, at: Date.now() },
        }));
      })
      .catch((error) => {
        reportFrontendError("player.gallery-anchor", error, { anchorId: command.anchor_id });
      });
  };
  engine.canSkipText = (textKey) => canSkipTextKey(get(), textKey);
  engine.onSkipBlocked = () => set({ skipToggleActive: false, skipHoldActive: false });
  engine.shouldSuppressTransitions = () => {
    // Page/shell transitions are mandatory. Skip mode may still suppress
    // scene-level visual effects, but the runtime shell must retain feedback.
    return engine.state.isSkipMode;
  };
  return {
    engine,
    engineState: snapshotEngineState(engine.state),
    screen: "library",
    exitConfirmationOpen: false,
    quickSavePending: false,
    saveMigrationOpen: false,
    saveMigrationPending: false,
    runtimeMode: "library",
    presentationMode: "development",
    saves: [],
    galleryUnlocks: [],
    isVoicePlaying: false,
    isUiHidden: false,
    skipToggleActive: false,
    skipHoldActive: false,
    launchTransition: "idle",
    launchTransitionId: 0,
    launchTransitionDurationMs: RUNTIME_BLACKOUT_COVER_DURATION_MS,
    galleryReplayActive: false,
    galleryReturnSnapshot: undefined,
    galleryReplayReturnScreen: undefined,
    galleryReturnSession: undefined,
    spritePresentationMode: "settle",
    setRuntimeMode: (runtimeMode) => set({
      runtimeMode,
      screen: runtimeMode === "library" ? "library" : "title_menu",
      pendingScreenNavigation: undefined,
      returnScreen: undefined,
      exitConfirmationOpen: false,
      isUiHidden: false,
      skipToggleActive: false,
      skipHoldActive: false,
    }),
    setPresentationMode: (presentationMode) => set({ presentationMode }),
    async loadGame(game) {
      const owner = ++saveOwner;
      set({ quickSavePending: false, quickLoadCandidate: undefined, saveNotice: undefined,
        galleryReplayActive: false, galleryReturnSnapshot: undefined, galleryReplayReturnScreen: undefined, galleryReturnSession: undefined,
        saveStorageInfo: undefined, saveMigrationOpen: false, saveMigrationPending: false, saveMigrationError: undefined });
      confirmingQuickLoad = false;
      clearCachedSavePreview();
      useSettingsStore.getState().loadForGame(game.install_id, game.game_id);
      assetResolver.configure(game.manifest, "", game.assetUrls);
      progressiveAssetLoader.configure(game);
      engine.loadScript(game.script, game.manifest);
      playtimeStartedAt = undefined;
      playtimeBaseSeconds = 0;
      resetAutoSaveTracking();
      const [saves, galleryUnlocks, storage] = await Promise.all([
        listDesktopSaves(game.install_id),
        listGalleryUnlocks(game.install_id),
        get().runtimeMode === "fixed"
          ? getSaveStorageInfo(game.install_id).then(info => ({ info, error: undefined as string | undefined }))
            .catch(error => {
              reportFrontendError("player.save-migration.scan", error, { installId: game.install_id, gameId: game.game_id });
              return { info: undefined, error: String(error instanceof Error ? error.message : error) };
            })
          : Promise.resolve({ info: undefined, error: undefined }),
      ]);
      if (owner !== saveOwner) return;
      const unlocked = new Set(galleryUnlocks);
      const hydratedGame = {
        ...game,
        gallery: game.gallery.map((item) => ({ ...item, unlocked: unlocked.has(item.anchor_id ?? item.item_id) })),
      };
      set({
        currentGame: hydratedGame,
        engineState: snapshotEngineState(engine.state),
        saves,
        saveStorageInfo: storage.info,
        saveMigrationOpen: Boolean(storage.info?.portable && storage.info.availableFiles.length),
        saveMigrationError: storage.error,
        galleryUnlocks,
        screen: "title_menu",
        pendingScreenNavigation: undefined,
        returnScreen: undefined,
        galleryReplayActive: false,
        galleryReturnSnapshot: undefined,
        isUiHidden: false,
        skipToggleActive: false,
      });
      progressiveAssetLoader.warmEntry();
    },
    updateLivePreviewAppearance(game) {
      const current = get().currentGame;
      if (get().runtimeMode !== "preview" || !current || current.game_id !== game.game_id)
        throw new Error("PREVIEW_APPEARANCE_OWNER: 外观更新不属于当前预览工程。");
      assetResolver.configure(game.manifest, "", game.assetUrls);
      // Keep the exact engine, screen, settings, typing, history, saves and audio.
      // This is a visual draft, not another cartridge load or playback request.
      set({ currentGame: { ...current, manifest: game.manifest, uiSkin: game.uiSkin, assetUrls: game.assetUrls } });
    },
    async loadLivePreview(game, start) {
      const owner = ++saveOwner;
      set({ quickSavePending: false, quickLoadCandidate: undefined, saveNotice: undefined,
        galleryReplayActive: false, galleryReturnSnapshot: undefined, galleryReplayReturnScreen: undefined, galleryReturnSession: undefined,
        saveStorageInfo: undefined, saveMigrationOpen: false, saveMigrationPending: false, saveMigrationError: undefined });
      confirmingQuickLoad = false;
      clearCachedSavePreview();
      useSettingsStore.getState().loadForGame(game.install_id, game.game_id);
      assetResolver.configure(game.manifest, "", game.assetUrls);
      progressiveAssetLoader.configure(game);
      engine.loadScript(game.script, game.manifest);
      playtimeStartedAt = undefined;
      playtimeBaseSeconds = 0;
      resetAutoSaveTracking();
      const [saves, galleryUnlocks] = await Promise.all([
        listDesktopSaves(game.install_id),
        listGalleryUnlocks(game.install_id),
      ]);
      if (owner !== saveOwner) return;
      const unlocked = new Set(galleryUnlocks);
      const hydratedGame = {
        ...game,
        gallery: game.gallery.map((item) => ({ ...item, unlocked: unlocked.has(item.anchor_id ?? item.item_id) })),
      };
      set({
        currentGame: hydratedGame,
        engineState: snapshotEngineState(engine.state),
        saves,
        galleryUnlocks,
        screen: "title_menu",
        pendingScreenNavigation: undefined,
        returnScreen: undefined,
        galleryReplayActive: false,
        galleryReturnSnapshot: undefined,
        isUiHidden: false,
        skipToggleActive: false,
        skipHoldActive: false,
      });
      if (start) await get().previewStart(start);
    },
    async openSaveMigration() {
      const game = get().currentGame;
      if (!game || get().saveMigrationPending) return;
      const owner = saveOwner;
      set({ saveMigrationOpen: true, saveMigrationPending: true, saveMigrationError: undefined });
      try {
        const info = await getSaveStorageInfo(game.install_id);
        if (owner !== saveOwner) return;
        set({ saveStorageInfo: info, saveMigrationOpen: Boolean(info?.portable) });
      } catch (error) {
        reportFrontendError("player.save-migration.scan", error, { installId: game.install_id, gameId: game.game_id });
        if (owner === saveOwner) set({ saveMigrationError: String(error instanceof Error ? error.message : error) });
      } finally {
        if (owner === saveOwner) set({ saveMigrationPending: false });
      }
    },
    closeSaveMigration() {
      if (!get().saveMigrationPending) set({ saveMigrationOpen: false });
    },
    async confirmSaveMigration() {
      const game = get().currentGame;
      if (!game || !get().saveMigrationOpen || get().saveMigrationPending || !get().saveStorageInfo?.portable) return;
      const owner = saveOwner;
      set({ saveMigrationPending: true, saveMigrationError: undefined });
      try {
        const info = await saveWrites.track(() => migrateLegacySaves(game.install_id, game.game_id));
        if (owner !== saveOwner) return;
        const saves = await listDesktopSaves(game.install_id);
        if (owner !== saveOwner) return;
        set({ saveStorageInfo: info, saves, saveMigrationOpen: false,
          saveNotice: { status: "saved", kind: "manual", at: Date.now(),
            message: `已复制 ${info.copiedFiles.length} 个旧存档；${info.conflictFiles.length} 个冲突保留未覆盖。源存档保留。` } });
      } catch (error) {
        reportFrontendError("player.save-migration.copy", error, { installId: game.install_id, gameId: game.game_id });
        if (owner === saveOwner) set({ saveMigrationError: String(error instanceof Error ? error.message : error) });
      } finally {
        if (owner === saveOwner) set({ saveMigrationPending: false });
      }
    },
    startNewGame() {
      return beginLaunch({ kind: "new_game" }, async (id) => {
        const ready = await progressiveAssetLoader.prepareEntry(10_000, (progress) => updateLaunchProgress(id, progress));
        if (!ready) throw new Error("开场资源准备超时，请稍后重试。");
        return { kind: "new_game" };
      });
    },
    startGame() {
      return get().startNewGame();
    },
    previewScene: (sceneId) => {
      return beginLaunch({ kind: "preview_scene", sceneId }, async () => ({
        kind: "preview_scene",
        previewSceneId: sceneId,
      }));
    },
    previewStart: (start) => {
      return beginLaunch({ kind: "preview_start" }, async () => ({
        kind: "preview_start",
        previewStart: structuredClone(start),
      }));
    },
    controlLivePreview: (control) => {
      engine.controlPreview(control.action, control.playbackRate);
      set({ engineState: snapshotEngineState(engine.state) });
    },
    async continueGame() {
      const save = latestCompatibleSave(get().saves);
      if (!save) {
        set({ entryError: get().saves.length > 0 ? "没有可用于继续的兼容存档。" : "当前还没有存档。" });
        return;
      }
      await beginLaunch(
        { kind: "continue_latest" },
        (id) => prepareSaveLaunch(id, { kind: saveKind(save), slot: save.slot }, "continue_latest"),
      );
    },
    resumeActiveGame() {
      if (!hasPlayableState(get().engineState)) return Promise.resolve();
      return beginLaunch({ kind: "resume_active" }, async (id) => {
        const sceneId = engine.state.currentSceneId;
        if (sceneId) {
          const ready = await progressiveAssetLoader.prepareScene(sceneId, 10_000, (progress) => updateLaunchProgress(id, progress));
          if (!ready) throw new Error("当前场景资源准备超时，请稍后重试。");
        }
        return { kind: "resume_active" };
      });
    },
    next: (automatic = false) => {
      if (get().isUiHidden) return;
      if (!automatic && engine.state.isAutoMode && !useSettingsStore.getState().settings.autoForwardAfterClick) {
        engine.state.isAutoMode = false;
      }
      engine.next(automatic);
      set({ engineState: snapshotEngineState(engine.state) });
    },
    setDialogPagePosition: (pageIndex, pageCount) => {
      const previousIndex = engine.state.dialogPageIndex;
      const previousCount = engine.state.dialogPageCount;
      engine.setDialogPagePosition(pageIndex, pageCount);
      if (previousIndex === engine.state.dialogPageIndex && previousCount === engine.state.dialogPageCount) return;
      set({ engineState: snapshotEngineState(engine.state) });
    },
    rollback: () => {
      const restored = engine.rollback();
      if (!restored) return false;
      resetAutoSaveTracking(stableCheckpointSignature(engine.state));
      set({
        engineState: snapshotEngineState(engine.state),
        skipToggleActive: false,
        skipHoldActive: false,
        isUiHidden: false,
        spritePresentationMode: "settle",
      });
      return true;
    },
    rollForward: () => {
      const restored = engine.rollForward();
      if (!restored) return false;
      resetAutoSaveTracking(stableCheckpointSignature(engine.state));
      set({
        engineState: snapshotEngineState(engine.state),
        skipToggleActive: false,
        skipHoldActive: false,
        isUiHidden: false,
        spritePresentationMode: "settle",
      });
      return true;
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
      const keepSkipping = useSettingsStore.getState().settings.skipAfterChoices;
      const wasSkipping = engine.state.isSkipMode;
      if (wasSkipping && !keepSkipping) engine.state.isSkipMode = false;
      engine.choose(choiceId);
      set({
        engineState: snapshotEngineState(engine.state),
        isUiHidden: false,
        skipToggleActive: wasSkipping && !keepSkipping ? false : get().skipToggleActive,
        skipHoldActive: wasSkipping && !keepSkipping ? false : get().skipHoldActive,
      });
    },
    async save(ref) {
      const owner = saveOwner;
      const snapshot = createSnapshot(ref);
      if (!snapshot) return;
      try {
        await persistSnapshot(ref, snapshot);
      } catch (error) {
        reportFrontendError("player.save", error, { kind: ref.kind, slot: ref.slot });
        if (owner === saveOwner) set({ saveNotice: { status: "error", kind: ref.kind, message: `存档写入失败：${error instanceof Error ? error.message : String(error)}`, at: Date.now() } });
        throw error;
      }
    },
    quickSave() {
      const owner = saveOwner;
      if (quickWrite?.owner === owner) return quickWrite.promise;
      const state = get();
      if (!state.currentGame || !hasPlayableState(state.engineState) || state.galleryReplayActive
        || state.launchTransition !== "idle") {
        const error = new Error("当前剧情状态无法快存。");
        set({ saveNotice: { status: "error", kind: "quick", message: error.message, at: Date.now() } });
        return Promise.reject(error);
      }
      const ref = chooseQuickSaveSlot(state.saves);
      const snapshot = createSnapshot(ref);
      if (!snapshot) return Promise.reject(new Error("当前剧情状态无法快存。"));
      set({ quickSavePending: true });
      const promise = persistSnapshot(ref, snapshot).catch(error => {
        reportFrontendError("player.quick-save", error, { installId: snapshot.install_id, slot: ref.slot });
        if (owner === saveOwner) set({ saveNotice: { status: "error", kind: "quick",
          message: `快存失败：${error instanceof Error ? error.message : String(error)}`, at: Date.now() } });
        throw error;
      }).finally(() => {
        if (quickWrite?.promise === promise) quickWrite = undefined;
        if (owner === saveOwner) set({ quickSavePending: false });
      });
      quickWrite = { owner, promise };
      return promise;
    },
    requestQuickLoad() {
      const state = get();
      if (state.galleryReplayActive || state.launchTransition !== "idle" || state.quickSavePending) return;
      const candidate = latestQuickSave(state.saves, save => !saveCompatibilityError(save));
      set({
        quickLoadCandidate: candidate,
        saveNotice: candidate ? state.saveNotice : {
          status: "error", kind: "quick", message: "没有可读取的有效快存，请先快速保存。", at: Date.now(),
        },
      });
    },
    cancelQuickLoad: () => {
      if (!confirmingQuickLoad) set({ quickLoadCandidate: undefined });
    },
    async confirmQuickLoad() {
      if (confirmingQuickLoad) return;
      const owner = saveOwner;
      const candidate = get().quickLoadCandidate;
      const installId = get().currentGame?.install_id;
      if (!candidate || !installId) return;
      confirmingQuickLoad = true;
      try {
        const ref: SaveSlotRef = { kind: "quick", slot: candidate.slot };
        const current = await readDesktopSave(installId, ref);
        if (owner !== saveOwner) return;
        if (!current || current.save_id !== candidate.save_id) throw new Error("这份快存已发生变化，请重新选择快读。");
        const issue = saveCompatibilityError(current);
        if (issue) throw new Error(issue);
        set({ quickLoadCandidate: undefined });
        await get().load(ref);
      } catch (error) {
        reportFrontendError("player.quick-load", error, { installId });
        if (owner === saveOwner) set({ saveNotice: { status: "error", kind: "quick",
          message: `快读失败：${error instanceof Error ? error.message : String(error)}`, at: Date.now() } });
      } finally {
        if (owner === saveOwner) confirmingQuickLoad = false;
      }
    },
    load(ref) {
      return beginLaunch({ kind: "load_slot", ref }, (id) => prepareSaveLaunch(id, ref, "load_slot"));
    },
    async openGalleryAnchor(anchorId) {
      const state = get();
      const item = state.currentGame?.gallery.find((candidate) => (
        candidate.anchor_id === anchorId || candidate.item_id === anchorId
      ));
      if (!item?.unlocked || !item.anchor_id || state.galleryReplayActive) return;
      await beginLaunch({ kind: "gallery_anchor", anchorId }, (id) => prepareGalleryLaunch(id, anchorId));
    },
    exitGalleryReplay: () => finishGalleryReplay(),
    async deleteSaveSlot(ref) {
      const installId = get().currentGame?.install_id;
      if (!installId) return;
      await deleteDesktopSave(installId, ref);
      set({ saves: await listDesktopSaves(installId) });
    },
    async upgradeSavePreviews() {
      if (previewUpgradePromise) return previewUpgradePromise;
      previewUpgradePromise = (async () => {
        const initialState = get();
        const installId = initialState.currentGame?.install_id;
        if (!installId) return;
        const candidates = initialState.saves.filter(
          (save) => save.preview_version !== SAVE_PREVIEW_VERSION,
        );
        for (const save of candidates) {
          if (get().currentGame?.install_id !== installId) return;
          const preview = await renderSavePreviewFromState(save);
          if (!preview) continue;
          const ref: SaveSlotRef = { kind: saveKind(save), slot: save.slot };
          const upgraded: SaveData = {
            ...save,
            preview_image: preview,
            preview_version: SAVE_PREVIEW_VERSION,
          };
          try {
            await saveWrites.track(() => writeDesktopSave(installId, ref, upgraded));
            set((state) => ({
              saves: state.saves.map((item) => (
                saveKind(item) === ref.kind && item.slot === ref.slot ? upgraded : item
              )),
            }));
          } catch (error) {
            reportFrontendError("player.save-preview-upgrade", error, {
              installId,
              kind: ref.kind,
              slot: ref.slot,
            });
          }
        }
      })().finally(() => {
        previewUpgradePromise = undefined;
      });
      return previewUpgradePromise;
    },
    beginLaunchCover() {
      const state = get();
      if (state.launchTransition !== "arming" || !state.launchTransitionId) return;
      set({ launchTransition: "covering" });
    },
    async completeLaunchCover() {
      const state = get();
      const id = state.launchTransitionId;
      if (state.launchTransition !== "covering" || !id) return;
      set({ launchTransition: "preparing" });
      const task = launchTasks.get(id);
      if (!task) {
        set({
          launchTransition: "revealing",
          launchTransitionDurationMs: launchRevealDurationMs(),
          launchPreparation: undefined,
          entryError: "进入游戏请求已失效，请重试。",
        });
        return;
      }
      try {
        const prepared = await task;
        if (get().launchTransitionId !== id) return;
        if (prepared.kind === "new_game") {
          resetPlaytime();
          resetAutoSaveTracking();
          engine.start();
          set({
            screen: "playing",
            engineState: snapshotEngineState(engine.state),
            returnScreen: undefined,
            isUiHidden: false,
            launchPreparation: undefined,
            spritePresentationMode: "animate",
          });
        } else if (prepared.kind === "resume_active") {
          set({
            screen: "playing",
            engineState: snapshotEngineState(engine.state),
            returnScreen: undefined,
            isUiHidden: false,
            launchPreparation: undefined,
            spritePresentationMode: "settle",
          });
        } else if (prepared.save) {
          resetPlaytime(prepared.save.playtime_seconds);
          resetAutoSaveTracking(`${prepared.save.scene_id}:${prepared.save.command_index}:${engine.state.currentCommandType ?? ""}`);
          engine.restoreSaveSnapshot(prepared.save);
          resetAutoSaveTracking(stableCheckpointSignature(engine.state));
          set({
            screen: "playing",
            engineState: snapshotEngineState(engine.state),
            saves: prepared.saves ?? get().saves,
            returnScreen: undefined,
            isUiHidden: false,
            launchPreparation: undefined,
            spritePresentationMode: "settle",
          });
        } else if (prepared.gallerySceneId) {
          // Capture only after preparation succeeds, before replay replaces the
          // engine. Gallery may have been reached through any shared menu.
          const previous = get();
          const snapshot = hasPlayableState(previous.engineState)
            ? createSnapshot({ kind: "manual", slot: 0 })
            : undefined;
          set({
            galleryReturnSnapshot: snapshot ? structuredClone(snapshot) : undefined,
            galleryReturnSession: snapshot ? engine.capturePlaybackSession() : undefined,
            galleryReplayReturnScreen: previous.screen === "gallery"
              ? previous.returnScreen
              : panelReturnScreen(previous),
          });
          resetPlaytime();
          resetAutoSaveTracking();
          set({
            galleryReplayActive: true,
            screen: "playing",
            isUiHidden: false,
            launchPreparation: undefined,
          });
          engine.startGalleryReplay(prepared.gallerySceneId);
          set({
            galleryReplayActive: true,
            screen: "playing",
            engineState: snapshotEngineState(engine.state),
            returnScreen: "gallery",
            isUiHidden: false,
            launchPreparation: undefined,
            spritePresentationMode: "settle",
          });
        } else if (prepared.gallerySave) {
          resetPlaytime(prepared.gallerySave.playtime_seconds);
          resetAutoSaveTracking();
          engine.restoreSaveSnapshot(prepared.gallerySave, { autoAdvance: true });
          set({
            screen: "playing",
            engineState: snapshotEngineState(engine.state),
            returnScreen: undefined,
            isUiHidden: false,
            launchPreparation: undefined,
            spritePresentationMode: "settle",
          });
        } else if (prepared.kind === "preview_scene" && prepared.previewSceneId) {
          resetPlaytime();
          resetAutoSaveTracking();
          engine.previewScene(prepared.previewSceneId, {
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
            launchPreparation: undefined,
            spritePresentationMode: "settle",
          });
        } else if (prepared.kind === "preview_start" && prepared.previewStart) {
          resetPlaytime();
          resetAutoSaveTracking();
          engine.previewStart(prepared.previewStart);
          set({
            screen: "playing",
            engineState: snapshotEngineState(engine.state),
            returnScreen: undefined,
            isUiHidden: false,
            skipToggleActive: false,
            skipHoldActive: false,
            launchPreparation: undefined,
            spritePresentationMode: "settle",
          });
        }
        await waitForFrames(2);
        if (get().launchTransitionId !== id) return;
        set({
          launchTransition: "revealing",
          launchTransitionDurationMs: launchRevealDurationMs(),
        });
      } catch (error) {
        reportFrontendError("player.game-entry", error, {
          operation: get().launchIntent?.kind ?? "unknown",
          requestId: id,
        });
        if (get().launchTransitionId !== id) return;
        set({
          launchTransition: "revealing",
          launchTransitionDurationMs: launchRevealDurationMs(),
          launchPreparation: undefined,
          entryError: error instanceof Error ? error.message : "进入游戏失败，请重试。",
        });
      }
    },
    completeLaunchReveal() {
      const state = get();
      const id = state.launchTransitionId;
      if (state.launchTransition !== "revealing" || !id) return;
      launchTasks.delete(id);
      set({
        launchTransition: "idle",
        launchTransitionId: 0,
        launchIntent: undefined,
        launchPreparation: undefined,
      });
      launchCompletionResolvers.get(id)?.();
      launchCompletionResolvers.delete(id);
    },
    consumeSpritePresentationMode: () => {
      if (get().spritePresentationMode !== "settle") return;
      set({ spritePresentationMode: "animate" });
    },
    flushAutoSave: async () => {
      const state = get();
      const settings = useSettingsStore.getState().settings;
      const existingWrites = saveWrites.wait();
      if (state.runtimeMode === "preview" || !settings.autoSaveEnabled) {
        const [pending, writes] = await Promise.all([autoSaveQueue.wait(), existingWrites]);
        if (writes.status === "failed") return writes;
        if (pending?.status === "failed") return pending;
        return {
          status: "skipped",
          reason: state.runtimeMode === "preview" ? "preview" : "disabled",
        };
      }
      const result = await scheduleAutoSave(engine.state, true);
      const [pending, writes, finalWrites] = await Promise.all([autoSaveQueue.wait(), existingWrites, saveWrites.wait()]);
      if (writes.status === "failed") return writes;
      if (finalWrites.status === "failed") return finalWrites;
      if (result.status !== "skipped") return result;
      return pending?.status === "failed" || pending?.status === "saved" ? pending : result;
    },
    openMenu: () => {
      if (get().galleryReplayActive) {
        finishGalleryReplay();
        return;
      }
      const state = get();
      requestScreenNavigation(
        state.currentGame && hasPlayableState(state.engineState) ? "main_menu" : fallbackMenuScreen(state),
        undefined,
      );
    },
    closeMenu: () => {
      const state = get();
      const target = normalizeReturnScreen(
        state.returnScreen ?? (hasPlayableState(state.engineState) ? "playing" : undefined),
        state,
      );
      // Back before the menu swap cancels that request. The existing player
      // never left; do not start a second launch, reset dialogue or audio.
      if (state.pendingScreenNavigation && target === state.screen) {
        state.cancelScreenNavigation(state.pendingScreenNavigation.id);
        return;
      }
      if (target === "playing") {
        void state.resumeActiveGame();
        return;
      }
      requestScreenNavigation(target, undefined);
    },
    toggleAuto: () => {
      if (get().isUiHidden) return;
      engine.state.isAutoMode = !engine.state.isAutoMode;
      engine.onChange?.(engine.state);
    },
    toggleSkip: () => {
      if (!get().isUiHidden) set((state) => applySkipFlags(state, !state.skipToggleActive, state.skipHoldActive));
    },
    disableSkip: () => {
      if (hiddenPlayback) { hiddenPlayback.toggle = false; hiddenPlayback.hold = false; }
      engine.state.isSkipMode = false;
      set({ skipToggleActive: false, skipHoldActive: false, engineState: snapshotEngineState(engine.state) });
    },
    setSkipHeld: (active) => {
      if (get().isUiHidden) {
        // Releasing Ctrl or losing window focus while hidden must not leave a
        // held key active when the interface returns.
        if (!active && hiddenPlayback) hiddenPlayback.hold = false;
        return;
      }
      set((state) => applySkipFlags(state, state.skipToggleActive, active));
    },
    setUiHidden: (hidden) => {
      const state = get();
      if (hidden === state.isUiHidden || (hidden && state.screen !== "playing")) return;
      if (hidden) {
        hiddenPlayback = { playthroughId: engine.state.playthroughId, auto: engine.state.isAutoMode,
          toggle: state.skipToggleActive, hold: state.skipHoldActive };
        engine.state.isAutoMode = false;
        engine.state.isSkipMode = false;
        set({ isUiHidden: true, skipToggleActive: false, skipHoldActive: false,
          engineState: snapshotEngineState(engine.state) });
      } else {
        const saved = hiddenPlayback;
        hiddenPlayback = undefined;
        if (saved && saved.playthroughId === engine.state.playthroughId && state.screen === "playing") {
          engine.state.isAutoMode = saved.auto;
          set({ isUiHidden: false, ...applySkipFlags(state, saved.toggle, saved.hold) });
        } else set({ isUiHidden: false });
      }
    },
    setVoicePlaying: (isVoicePlaying) => set({ isVoicePlaying }),
    markCurrentDialogRead: (textKey) => {
      const state = get();
      markTextRead(progressGameId(state), textKey ?? state.engineState.dialog?.text_key);
    },
    openHistory: () => {
      const state = get();
      requestScreenNavigation("history", panelReturnScreen(state));
    },
    openSaveLoad: async () => {
      const state = get();
      if (state.galleryReplayActive) return;
      if (state.screen === "playing" && state.engineState.currentSceneId) {
        void cacheCurrentSavePreview({
          scene_id: state.engineState.currentSceneId,
          command_index: state.engineState.currentCommandIndex,
        }).catch((error) => {
          console.warn("Background save preview capture failed.", error);
        });
      }
      requestScreenNavigation("save_load", panelReturnScreen(get()));
    },
    openSettings: () => {
      const state = get();
      requestScreenNavigation("settings", panelReturnScreen(state));
    },
    returnToTitle: () => {
      get().flushAutoSave();
      const state = get();
      requestScreenNavigation(
        fallbackMenuScreen({ currentGame: state.currentGame, runtimeMode: state.runtimeMode }),
        undefined,
      );
    },
    openLibrary: () => {
      const state = get();
      requestScreenNavigation(
        state.runtimeMode === "library" ? "library" : fallbackMenuScreen(state),
        undefined,
      );
    },
    openGallery: () => {
      const state = get();
      const returnScreen = panelReturnScreen(state);
      requestScreenNavigation("gallery", returnScreen);
    },
    openAbout: () => {
      const state = get();
      requestScreenNavigation("about", panelReturnScreen(state));
    },
    openHelp: () => {
      const state = get();
      requestScreenNavigation("help", panelReturnScreen(state));
    },
    openExitConfirmation: () => set({ exitConfirmationOpen: true }),
    closeExitConfirmation: () => set({ exitConfirmationOpen: false }),
    openPreviewScreen: (screen) => {
      const state = get();
      if (screen === "playing") {
        if (!state.currentGame) return;
        // A preview-ready acknowledgement may request the already visible
        // player. Re-entering it starts an unrelated launch that can overlap
        // the next queued live patch and reset the selected scene.
        if (state.screen === "playing") return;
        if (hasPlayableState(state.engineState)) {
          void state.resumeActiveGame();
        } else {
          void state.startNewGame();
        }
        return;
      }
      const current = get();
      if (!current.currentGame && screen !== "library") return;
      requestScreenNavigation(screen, undefined);
    },
    commitScreenNavigation: (id) => {
      const pending = get().pendingScreenNavigation;
      if (!pending || pending.id !== id) return;
      set({
        screen: pending.toScreen,
        returnScreen: pending.returnScreen,
        pendingScreenNavigation: undefined,
        isUiHidden: false,
      });
    },
    cancelScreenNavigation: (id) => {
      if (get().pendingScreenNavigation?.id !== id) return;
      set({ pendingScreenNavigation: undefined });
    },
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
