import "./App.css";
import { lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { toJpeg } from "html-to-image";
import { ErrorView } from "../components/common/ErrorView";
import { BootAnimation, BootCircleLoader } from "../components/common/BootAnimation";
import { OpeningScreen } from "../components/common/OpeningScreen";
import { OpeningAudioPlayer } from "../components/common/OpeningAudioPlayer";
import { RuntimeAudio } from "../components/player/RuntimeAudio";
import { ExitGameDialog } from "../components/shell/ExitGameDialog";
import { useLibraryStore } from "../store/libraryStore";
import { useRuntimeStore } from "../store/runtimeStore";
import { QuickLoadDialog } from "../components/shell/QuickLoadDialog";
import { SaveMigrationDialog } from "../components/shell/SaveMigrationDialog";
import { RuntimeScreenNavigator } from "./RuntimeScreenNavigator";
import type { RuntimeScreen } from "../store/runtimeStore";
import { setRuntimeWindowTitle } from "../engine/displayMode";
import type { LoadingAnimationConfig } from "../types/script";
import { UISkinProvider, UISkinScreen } from "../uiSkin/uiSkinRuntime";
import { installRuntimeAnimationResidueCleanup } from "../utils/animationResidue";
import { routeRuntimeWindowCloseRequest } from "../utils/runtimeWindowClose";
import { routeRuntimeSystemBack } from "../utils/runtimeSystemBack";
import { isTauriRuntime } from "../utils/platform";
import { progressiveAssetLoader } from "../engine/progressiveAssetLoader";
import { getLaunchConfig } from "./launchConfig";
import {
  LIVE_PREVIEW_PROTOCOL_VERSION,
  isLivePreviewEditorMessage,
  type LivePreviewEditorMessage,
  type LivePreviewScreen,
  type LivePreviewRuntimeMessage,
  type PreviewStartSpec,
} from "../../../shared/preview/livePreviewProtocol";
import { resolveLivePreviewPatchStart } from "../../../shared/preview/livePreviewPatch";
import { buildGalleryManifestFromScript } from "../../../shared/cartridge/gallery";
import type { LibraryGame } from "../types/cartridge";
import { installNativeInteractionGuards } from "../../../shared/ui/nativeInteractionGuards";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { validateUISkinLayout } from "../../../shared/cartridge/uiSkin";
import { installRuntimeDiagnostics, recordRuntimeAudio, recordRuntimeError, recordRuntimeScreen } from "../utils/runtimeDiagnostics";

const loadStoryPlayer = () => import("../components/player/StoryPlayer").then((module) => ({ default: module.StoryPlayer }));
const loadAboutScreen = () => import("../components/shell/AboutScreen").then((module) => ({ default: module.AboutScreen }));
const loadHelpScreen = () => import("../components/shell/HelpScreen").then((module) => ({ default: module.HelpScreen }));
const loadGalleryScreen = () => import("../components/shell/GalleryScreen").then((module) => ({ default: module.GalleryScreen }));
const loadGameLibrary = () => import("../components/shell/GameLibrary").then((module) => ({ default: module.GameLibrary }));
const loadHistoryScreen = () => import("../components/shell/HistoryScreen").then((module) => ({ default: module.HistoryScreen }));
const loadMainMenu = () => import("../components/shell/MainMenu").then((module) => ({ default: module.MainMenu }));
const loadSaveLoadScreen = () => import("../components/shell/SaveLoadScreen").then((module) => ({ default: module.SaveLoadScreen }));
const loadSettingsScreen = () => import("../components/shell/SettingsScreen").then((module) => ({ default: module.SettingsScreen }));

const StoryPlayer = lazy(loadStoryPlayer);
const AboutScreen = lazy(loadAboutScreen);
const HelpScreen = lazy(loadHelpScreen);
const GalleryScreen = lazy(loadGalleryScreen);
const GameLibrary = lazy(loadGameLibrary);
const HistoryScreen = lazy(loadHistoryScreen);
const MainMenu = lazy(loadMainMenu);
const SaveLoadScreen = lazy(loadSaveLoadScreen);
const SettingsScreen = lazy(loadSettingsScreen);

function isFormOrTextInputTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : document.activeElement instanceof Element ? document.activeElement : null;
  return Boolean(element?.closest("input, textarea, select, form, [contenteditable], [role='textbox']"));
}

function hasOpenModal() {
  return Boolean(document.querySelector("[data-runtime-modal='true']"));
}

const MAX_LIVE_PREVIEW_FRAME_BYTES = 160 * 1024;

function dataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.ceil(payload.length * 0.75);
}

async function captureLivePreviewFrame(): Promise<string | undefined> {
  const target = document.querySelector<HTMLElement>("[data-runtime-screen]")
    ?? document.querySelector<HTMLElement>("#root");
  if (!target) return undefined;
  for (const quality of [0.72, 0.48]) {
    try {
      const image = await toJpeg(target, {
        width: 480,
        height: 270,
        canvasWidth: 480,
        canvasHeight: 270,
        quality,
        backgroundColor: "#050810",
        pixelRatio: 1,
        skipFonts: true,
      });
      if (dataUrlBytes(image) <= MAX_LIVE_PREVIEW_FRAME_BYTES) return image;
    } catch {
      // error-log-ignore: 冻结帧截图失败会立即改用编辑器的磨砂占位，这是明确设计的正常回退。
    }
  }
  return undefined;
}

async function loadEmbeddedFixedGame() {
  const { loadGameFromEmbeddedDirectory } = await import("../cartridge/desktopLibrary");
  return loadGameFromEmbeddedDirectory();
}

interface RuntimePreviewMessage {
  type?: string;
  cartridgeBytes?: number[];
  cartridgeBuffer?: ArrayBuffer;
  cartridgeBase64?: string;
  fileName?: string;
  previewNonce?: string;
  screen?: string;
  sessionId?: string;
  revision?: number;
}

function livePreviewGame(
  message: Extract<LivePreviewEditorMessage, { type: "agentvn.live-preview.init" }>,
): LibraryGame {
  const now = new Date().toISOString();
  const gallery = buildGalleryManifestFromScript(message.script).items.map((item) => ({
    item_id: item.item_id,
    title: item.title,
    description: item.description,
    asset_id: item.asset_id,
    anchor_id: item.anchor_id ?? item.item_id,
    scene_id: item.scene_id,
    command_index: item.command_index,
    unlocked: false,
  }));
  return {
    install_id: `live_preview_${message.manifest.game_id}`,
    game_id: message.manifest.game_id,
    title: message.manifest.title,
    author: message.manifest.author,
    version: message.manifest.version,
    description: message.manifest.description,
    cover: message.manifest.cover,
    manifest: message.manifest as LibraryGame["manifest"],
    script: message.script as LibraryGame["script"],
    gallery,
    uiSkin: message.uiSkin,
    assetUrls: message.assetUrls,
    imported_at: now,
    updated_at: now,
    language: message.manifest.language,
    source_file_name: "live-preview",
  };
}

function mergeLivePreviewGame(
  current: LibraryGame,
  message: Extract<LivePreviewEditorMessage, { type: "agentvn.live-preview.patch" }>,
): LibraryGame {
  const manifest = (message.manifest ?? current.manifest) as LibraryGame["manifest"];
  let script = (message.script ?? current.script) as LibraryGame["script"];
  if (!message.script && message.scenes) {
    const patches = new Map(message.scenes.map((scene) => [scene.scene_id, scene]));
    script = {
      ...current.script,
      scenes: current.script.scenes.map((scene) => (
        patches.get(scene.scene_id) as LibraryGame["script"]["scenes"][number] | undefined
      ) ?? scene),
    };
  }
  return {
    ...current,
    game_id: manifest.game_id,
    title: manifest.title,
    author: manifest.author,
    version: manifest.version,
    description: manifest.description,
    cover: manifest.cover,
    manifest,
    script,
    uiSkin: message.uiSkin ?? current.uiSkin,
    assetUrls: message.assetUrls ?? current.assetUrls,
    updated_at: new Date().toISOString(),
  };
}

function previewPayloadToArrayBuffer(message: RuntimePreviewMessage): ArrayBuffer | undefined {
  if (message.cartridgeBuffer instanceof ArrayBuffer && message.cartridgeBuffer.byteLength > 0) {
    return message.cartridgeBuffer.slice(0);
  }
  if (typeof message.cartridgeBase64 === "string" && message.cartridgeBase64.length > 0) {
    const binary = window.atob(message.cartridgeBase64);
    const view = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) view[index] = binary.charCodeAt(index);
    return view.buffer;
  }
  const bytes = message.cartridgeBytes;
  if (!Array.isArray(bytes) || bytes.length === 0) return undefined;
  const view = new Uint8Array(bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function RuntimeScreenLoading() {
  return (
    <div className="runtime-screen-loading" role="status" aria-live="polite">
      <BootCircleLoader />
    </div>
  );
}

function hasCustomBootAnimation(animation: LoadingAnimationConfig | undefined, assetUrls: Record<string, string>): boolean {
  if (animation?.kind === "video") return Boolean(assetUrls[animation.video_asset_id]);
  if (animation?.kind === "image_sequence") return animation.image_asset_ids.some((assetId) => Boolean(assetUrls[assetId]));
  return false;
}

const readyScreens = new Map<RuntimeScreen, ComponentType>();
async function preloadRuntimeScreen(screen: RuntimeScreen): Promise<void> {
  const loaded = screen === "playing" ? await loadStoryPlayer()
    : screen === "library" ? await loadGameLibrary()
    : screen === "settings" ? await loadSettingsScreen()
    : screen === "save_load" ? await loadSaveLoadScreen()
    : screen === "gallery" ? await loadGalleryScreen()
    : screen === "history" ? await loadHistoryScreen()
    : screen === "about" ? await loadAboutScreen()
    : screen === "help" ? await loadHelpScreen()
    : await loadMainMenu();
  readyScreens.set(screen, loaded.default);
}

function renderRuntimeScreen(screen: RuntimeScreen, withinMenu = false): ReactNode {
  const Page = readyScreens.get(screen) ?? (screen === "playing" ? StoryPlayer
    : screen === "library" ? GameLibrary : screen === "settings" ? SettingsScreen
    : screen === "save_load" ? SaveLoadScreen : screen === "gallery" ? GalleryScreen
    : screen === "history" ? HistoryScreen : screen === "about" ? AboutScreen
    : screen === "help" ? HelpScreen : MainMenu);
  const content = <Page />;
  if (withinMenu || screen === "help") return content;
  const scope = screen === "playing" ? "player" : screen === "library" ? "game_menu"
    : screen === "settings" ? "preferences" : screen === "title_menu" || screen === "main_menu" ? "title" : screen;
  return <UISkinScreen screen={scope}>{content}</UISkinScreen>;
}

export function App() {
  const [bootStatus, setBootStatus] = useState("准备启动 GameCLI 容器...");
  const [bootError, setBootError] = useState<string>();
  const [booting, setBooting] = useState(true);
  const [bootOverlayVisible, setBootOverlayVisible] = useState(true);
  const [bootAnimation, setBootAnimation] = useState<LoadingAnimationConfig>();
  const [bootAssetUrls, setBootAssetUrls] = useState<Record<string, string>>({});
  const [bootStage, setBootStage] = useState<"line" | "opening">("line");
  const [bootReady, setBootReady] = useState(false);
  const [openingCycleComplete, setOpeningCycleComplete] = useState(false);
  const [startupAudioActive, setStartupAudioActive] = useState(false);
  const [launchFeedbackVisible, setLaunchFeedbackVisible] = useState(false);
  const bootContentRef = useRef<HTMLDivElement>(null);
  const initialize = useLibraryStore((state) => state.initialize);
  const screen = useRuntimeStore((state) => state.screen);
  const exitConfirmationOpen = useRuntimeStore((state) => state.exitConfirmationOpen);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const currentGameTitle = useRuntimeStore((state) => state.currentGame?.title);
  const launchTransition = useRuntimeStore((state) => state.launchTransition);
  const launchTransitionId = useRuntimeStore((state) => state.launchTransitionId);
  const launchIntent = useRuntimeStore((state) => state.launchIntent);
  const launchTransitionDurationMs = useRuntimeStore((state) => state.launchTransitionDurationMs);
  const launchPreparation = useRuntimeStore((state) => state.launchPreparation);
  const setRuntimeMode = useRuntimeStore((state) => state.setRuntimeMode);
  const loadGame = useRuntimeStore((state) => state.loadGame);
  const hideBootOverlay = useCallback(() => setBootOverlayVisible(false), []);
  const bootBlocking = bootOverlayVisible || Boolean(bootError);
  useLayoutEffect(() => {
    const content = bootContentRef.current;
    if (!content) return;
    content.toggleAttribute("inert", bootBlocking);
    if (!bootBlocking) {
      const target = content.querySelector<HTMLElement>(".runtime-screen-transition-current");
      (target ?? content).focus({ preventScroll: true });
    }
  }, [bootBlocking]);
  const resetBootSession = useCallback(() => {
    setBootOverlayVisible(true);
    setBootError(undefined);
    setBooting(true);
    setBootStage("line");
    setBootReady(false);
    setOpeningCycleComplete(false);
    setStartupAudioActive(false);
  }, []);
  const processedPreviewNoncesRef = useRef<string[]>([]);
  const livePreviewRevisionRef = useRef(0);
  const livePreviewActiveRef = useRef(false);
  const livePreviewSessionRef = useRef("");
  const livePreviewRunRef = useRef("");
  const livePreviewStartRef = useRef<PreviewStartSpec>();
  const livePreviewPatchQueueRef = useRef<Promise<void>>(Promise.resolve());
  const livePreviewScreenTargetRef = useRef<{
    source: MessageEventSource;
    origin: string;
    identity: { sessionId: string; revision: number; requestId: string; runId: string };
  }>();
  useEffect(() => installRuntimeAnimationResidueCleanup(document), []);
  useEffect(() => {
    document.documentElement.removeAttribute("data-runtime-transitions-disabled");
    return () => document.documentElement.removeAttribute("data-runtime-transitions-disabled");
  }, []);
  useEffect(() => installNativeInteractionGuards(document), []);
  useEffect(() => installRuntimeDiagnostics(), []);
  useEffect(() => {
    recordRuntimeScreen(screen);
  }, [screen]);
  useEffect(() => useRuntimeStore.subscribe((next, previous) => {
    if (next.screen === previous.screen || !livePreviewActiveRef.current) return;
    const target = livePreviewScreenTargetRef.current;
    if (!target) return;
    const supported: LivePreviewScreen[] = ["title_menu", "playing", "settings", "save_load", "history", "gallery", "about", "help"];
    if (!supported.includes(next.screen as LivePreviewScreen)) return;
    target.source.postMessage({
      type: "agentvn.live-preview.screen-change",
      protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
      ...target.identity,
      screen: next.screen as LivePreviewScreen,
    } satisfies LivePreviewRuntimeMessage, { targetOrigin: target.origin });
  }), []);

  useEffect(() => {
    function flushWhenHidden() {
      const hidden = document.visibilityState === "hidden";
      progressiveAssetLoader.setPaused(hidden);
      if (hidden) {
        useRuntimeStore.getState().flushAutoSave();
      } else {
        progressiveAssetLoader.warmEntry();
        const sceneId = useRuntimeStore.getState().engineState.currentSceneId;
        if (sceneId) progressiveAssetLoader.warmSuccessors(sceneId);
      }
    }
    progressiveAssetLoader.setPaused(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => document.removeEventListener("visibilitychange", flushWhenHidden);
  }, []);

  useEffect(() => {
    void setRuntimeWindowTitle(currentGameTitle);
  }, [currentGameTitle]);

  useEffect(() => {
    function handleSystemBack(event: Event) {
      if (event.defaultPrevented || hasOpenModal()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (document.querySelector("[data-runtime-boot-blocking]")) return;
      const runtime = useRuntimeStore.getState();
      routeRuntimeSystemBack(runtime, {
        openMenu: runtime.openMenu,
        closeMenu: runtime.closeMenu,
        openExitConfirmation: runtime.openExitConfirmation,
        restoreUi: () => runtime.setUiHidden(false),
      });
    }

    window.addEventListener("agentvn:system-back", handleSystemBack, true);
    return () => window.removeEventListener("agentvn:system-back", handleSystemBack, true);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const stop = await getCurrentWindow().onCloseRequested((event) => {
          routeRuntimeWindowCloseRequest(event, () => {
            useRuntimeStore.getState().openExitConfirmation();
          });
        });
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        reportFrontendError("player.window", error, { operation: "listen-close-requested" });
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const loadPreviewCartridge = useCallback(async (cartridgeBuffer: ArrayBuffer, fileName?: string) => {
    resetBootSession();
    setBootStatus("正在接收编辑器预览卡带...");
    try {
      const { loadGameFromArrayBuffer } = await import("../cartridge/desktopLibrary");
      const game = await loadGameFromArrayBuffer(cartridgeBuffer.slice(0), {
        installId: "preview_gamecli",
        sourceFileName: fileName ?? "preview.vncart",
      });
      setBootAnimation(game.script.loading_animation);
      setBootAssetUrls(game.assetUrls ?? {});
      setBootStatus("预览卡带已载入，正在准备播放器...");
      // Legacy complete-cartridge preview is a playable runtime. The structured
      // live-preview protocol uses `preview` with project-isolated save data.
      setRuntimeMode("fixed");
      await loadGame(game);
      setBootReady(true);
      setBootStatus("进入预览标题菜单...");
    } catch (error) {
      reportFrontendError("player.preview-load", error, { fileName });
      setBootError(error instanceof Error ? error.message : String(error));
    } finally {
      setBooting(false);
    }
  }, [loadGame, resetBootSession, setRuntimeMode]);

  useEffect(() => {

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isFormOrTextInputTarget(event.target) || hasOpenModal()) return;
      if (document.querySelector("[data-runtime-boot-blocking]")) return;
      const runtime = useRuntimeStore.getState();
      const hasGame = Boolean(runtime.currentGame);
      const isPlaying = runtime.screen === "playing";
      const hasBlockingVideo = Boolean(runtime.engineState.activeVideo);

      if (isPlaying && hasGame && runtime.isUiHidden) {
        if (["h", "H", "Escape", "Enter", " ", "Control", "PageUp", "PageDown"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat && ["h", "H", "Escape"].includes(event.key)) runtime.setUiHidden(false);
        }
        return;
      }

      if (isPlaying && hasGame && runtime.engineState.focusedImage && ["Enter", " ", "Escape"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        document.querySelector<HTMLElement>("[data-testid='focused-image-overlay']")?.click();
        return;
      }

      if (event.key === "Control" && isPlaying && hasGame && !hasBlockingVideo && !event.repeat) {
        event.preventDefault();
        runtime.setSkipHeld(true);
        return;
      }

      if ((event.key === "PageUp" || event.key === "PageDown") && isPlaying && hasGame && !hasBlockingVideo) {
        const moved = event.key === "PageUp" ? runtime.rollback() : runtime.rollForward();
        if (moved) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if ((event.key === " " || event.key === "Enter") && isPlaying && hasGame && !hasBlockingVideo && runtime.engineState.choices.length === 0 && !runtime.engineState.isWaitingChoice) {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("button, a, [role='button']")) return;
        event.preventDefault();
        // Use the same reveal/page/advance action as a pointer. Calling the
        // engine directly skips the currently displayed fragment's owner.
        const dialog = document.querySelector<HTMLButtonElement>(".story-player .dialog-box");
        if (dialog) dialog.click();
        else runtime.next();
        return;
      }


      if ((event.key === "h" || event.key === "H") && isPlaying && hasGame && !hasBlockingVideo) {
        event.preventDefault();
        if (event.repeat) return;
        runtime.setUiHidden(!runtime.isUiHidden);
        return;
      }

      if (event.key !== "Escape" || !hasGame || hasBlockingVideo) return;
      event.preventDefault();
      event.stopPropagation();
      const navigationScreen = runtime.pendingScreenNavigation?.toScreen ?? runtime.screen;
      if (navigationScreen === "playing") runtime.openMenu();
      else if (navigationScreen === "main_menu" || runtime.returnScreen
        || runtime.pendingScreenNavigation?.returnScreen) runtime.closeMenu();
    }

    function handleGlobalKeyUp(event: KeyboardEvent) {
      if (event.key !== "Control") return;
      useRuntimeStore.getState().setSkipHeld(false);
    }

    function handleWindowBlur() {
      useRuntimeStore.getState().setSkipHeld(false);
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("keyup", handleGlobalKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("keyup", handleGlobalKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        setBootStatus("读取启动模式...");
        const config = await getLaunchConfig();
        if (cancelled || livePreviewActiveRef.current) return;
        setRuntimeMode(config.mode);
        useRuntimeStore.getState().setPresentationMode(config.presentationMode);
        if (config.mode === "library") {
          setBootStatus("读取本地卡带库...");
          await initialize();
          setBootReady(true);
          return;
        }

        if (config.mode === "preview" && !config.cartridgePath && !config.previewRoot) {
          setBootStatus("等待编辑器发送 GameCLI 预览卡带...");
          return;
        }

        setBootStatus(config.mode === "preview" ? "装载编辑器临时预览卡带..." : "装载固定内嵌卡带...");
        const game = config.previewRoot
          ? await import("../cartridge/desktopLibrary").then((module) =>
              module.loadGameFromUnpackedPreview(config.previewRoot!)
            )
          : config.cartridgePath
            ? await import("../cartridge/desktopLibrary").then((module) =>
                module.loadGameFromPath(config.cartridgePath!, config.mode === "preview" ? "preview_gamecli" : "fixed_embedded_game")
              )
            : await loadEmbeddedFixedGame();
        if (cancelled || livePreviewActiveRef.current) return;
        setBootAnimation(game.script.loading_animation);
        setBootAssetUrls(game.assetUrls ?? {});
        setBootStatus("校验卡带脚本并准备播放器...");
        await loadGame(game);
        setBootReady(true);
        setBootStatus("进入标题菜单...");
      } catch (error) {
        reportFrontendError("player.boot", error, { phase: "load-game" });
        if (!cancelled) setBootError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [initialize, loadGame, setRuntimeMode]);

  useEffect(() => {
    async function handlePreviewMessage(event: MessageEvent<RuntimePreviewMessage>) {
      const allowedOrigin = event.origin === window.location.origin
        || event.origin === "http://127.0.0.1:6767"
        || (window.parent !== window && event.source === window.parent);
      if (!allowedOrigin) return;
      if (isLivePreviewEditorMessage(event.data)) {
        const message = event.data;
        if (message.type === "agentvn.live-preview.init" && message.sessionId !== livePreviewSessionRef.current) {
          livePreviewSessionRef.current = message.sessionId;
          livePreviewRevisionRef.current = 0;
          livePreviewRunRef.current = "";
          livePreviewStartRef.current = undefined;
        } else if (message.sessionId !== livePreviewSessionRef.current) {
          return;
        }
        if (message.revision <= livePreviewRevisionRef.current) return;
        if (
          message.type === "agentvn.live-preview.control"
          && message.runId !== livePreviewRunRef.current
        ) return;
        livePreviewRevisionRef.current = message.revision;
        if (message.type !== "agentvn.live-preview.freeze-frame.request"
          && livePreviewScreenTargetRef.current?.source === event.source) {
          livePreviewScreenTargetRef.current.identity = {
            sessionId: message.sessionId, revision: message.revision,
            requestId: message.requestId, runId: message.runId,
          };
        }
        const respond = (response: LivePreviewRuntimeMessage) => {
          event.source?.postMessage(response, { targetOrigin: event.origin });
        };
        if (message.type === "agentvn.live-preview.freeze-frame.request") {
          void captureLivePreviewFrame().then((image) => {
            respond({
              type: "agentvn.live-preview.freeze-frame.result",
              protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
              sessionId: message.sessionId,
              revision: message.revision,
              requestId: message.requestId,
              runId: message.runId,
              ...(image ? { image } : { unavailable: true }),
            });
          });
          return;
        }
        try {
          const runtime = useRuntimeStore.getState();
          if (message.type === "agentvn.live-preview.init") {
            if (event.source) livePreviewScreenTargetRef.current = {
              source: event.source,
              origin: event.origin,
              identity: {
                sessionId: message.sessionId, revision: message.revision,
                requestId: message.requestId, runId: message.runId,
              },
            };
            livePreviewActiveRef.current = true;
            setBootError(undefined);
            setBooting(false);
            setBootStage("opening");
            setBootReady(false);
            setOpeningCycleComplete(true);
            setStartupAudioActive(false);
            setBootOverlayVisible(false);
            setRuntimeMode("preview");
            // Full initialization and patch share one queue. A second init
            // must never commit before an older async save/gallery load ends.
            const queuedInit = livePreviewPatchQueueRef.current.then(async () => {
              if (message.sessionId !== livePreviewSessionRef.current
                || message.revision !== livePreviewRevisionRef.current) return;
              livePreviewStartRef.current = structuredClone(message.start);
              livePreviewRunRef.current = message.runId;
              await useRuntimeStore.getState().loadLivePreview(livePreviewGame(message), message.start);
              if (message.sessionId !== livePreviewSessionRef.current
                || message.revision !== livePreviewRevisionRef.current) return;
              if (message.screen && message.screen !== "playing")
                useRuntimeStore.getState().openPreviewScreen(message.screen);
            });
            livePreviewPatchQueueRef.current = queuedInit.then(() => undefined, () => undefined);
            await queuedInit;
          } else if (message.type === "agentvn.live-preview.start") {
            livePreviewStartRef.current = structuredClone(message.start);
            livePreviewRunRef.current = message.runId;
            await runtime.previewStart(message.start);
          } else if (message.type === "agentvn.live-preview.patch") {
            const queuedPatch = livePreviewPatchQueueRef.current.then(async () => {
              if (message.sessionId !== livePreviewSessionRef.current
                || message.revision !== livePreviewRevisionRef.current) return;
              const latestRuntime = useRuntimeStore.getState();
              const current = latestRuntime.currentGame;
              if (!current) throw new Error("实时预览尚未初始化。");
              if (message.presentationOnly) {
                if (message.script || message.scenes || message.start || !message.uiSkin
                  || message.manifest && message.manifest.game_id !== current.game_id)
                  throw new Error("PREVIEW_APPEARANCE_PAYLOAD: 外观更新不能改变剧情、播放位置或工程身份。");
                const validation = validateUISkinLayout(message.uiSkin);
                if (validation.errors.length) throw new Error(`PREVIEW_APPEARANCE_INVALID: ${validation.errors.map(issue => issue.message).join("；")}`);
                latestRuntime.updateLivePreviewAppearance({
                  game_id: current.game_id, manifest: (message.manifest ?? current.manifest) as LibraryGame["manifest"],
                  uiSkin: message.uiSkin, assetUrls: message.assetUrls ?? current.assetUrls,
                });
                livePreviewRunRef.current = message.runId;
                return;
              }
              const requestedStart = message.start ?? livePreviewStartRef.current;
              if (!requestedStart) throw new Error("还没有可用的预览位置，请重新打开预览。");
              const nextGame = mergeLivePreviewGame(current, message);
              const start = resolveLivePreviewPatchStart(nextGame.script, requestedStart, message.requestId);
              livePreviewStartRef.current = structuredClone(start);
              livePreviewRunRef.current = message.runId;
              await latestRuntime.loadLivePreview(nextGame, start);
            });
            livePreviewPatchQueueRef.current = queuedPatch.then(
              () => undefined,
              () => undefined,
            );
            await queuedPatch;
          } else {
            runtime.controlLivePreview(message);
          }
          respond({
            type: "agentvn.live-preview.ready",
            protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
            sessionId: message.sessionId,
            revision: message.revision,
            requestId: message.requestId,
            runId: message.runId,
            sceneId: useRuntimeStore.getState().engineState.currentSceneId || undefined,
            commandIndex: useRuntimeStore.getState().engineState.currentCommandIndex,
          });
        } catch (error) {
          reportFrontendError("player.live-preview", error, {
            type: message.type,
            requestId: message.requestId,
            runId: message.runId,
          });
          const target = "start" in message ? message.start?.target : livePreviewStartRef.current?.target;
          respond({
            type: "agentvn.live-preview.error",
            protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
            sessionId: message.sessionId,
            revision: message.revision,
            requestId: message.requestId,
            runId: message.runId,
            message: error instanceof Error ? error.message : String(error),
            sceneId: target?.sceneId,
            commandIndex: target?.commandIndex,
          });
        }
        return;
      }
      if (event.data?.type === "agentvn.runtime.confirmation-preview") {
        if (window.parent !== window && event.source === window.parent
          && livePreviewActiveRef.current && event.data.sessionId === livePreviewSessionRef.current
          && event.data.revision === livePreviewRevisionRef.current) {
          useRuntimeStore.getState().openExitConfirmation();
        }
        return;
      }
      if (event.data?.type === "agentvn.runtime.screen") {
        const screen = event.data.screen;
        if (screen === "title_menu" || screen === "playing" || screen === "settings" || screen === "save_load" || screen === "history" || screen === "gallery" || screen === "about" || screen === "help") {
          useRuntimeStore.getState().openPreviewScreen(screen);
        }
        return;
      }
      if (event.data?.type !== "agentvn.runtime.preview") return;
      const previewNonce = event.data.previewNonce;
      if (previewNonce) {
        if (processedPreviewNoncesRef.current.includes(previewNonce)) return;
        processedPreviewNoncesRef.current = [...processedPreviewNoncesRef.current, previewNonce].slice(-12);
      }
      const cartridgeBuffer = previewPayloadToArrayBuffer(event.data);
      if (!cartridgeBuffer) {
        reportFrontendError("player.preview-load", "编辑器发送的预览卡带为空。");
        setBootError("编辑器发送的预览卡带为空。");
        return;
      }
      void loadPreviewCartridge(cartridgeBuffer, event.data.fileName).then(() => {
        const screen = event.data.screen;
        if (screen === "title_menu" || screen === "playing" || screen === "settings" || screen === "save_load" || screen === "history" || screen === "gallery" || screen === "about" || screen === "help") {
          useRuntimeStore.getState().openPreviewScreen(screen);
        }
      });
    }

    window.addEventListener("message", handlePreviewMessage);
    if (window.parent !== window) {
      window.parent.postMessage({
        type: "agentvn.live-preview.ready",
        protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
        sessionId: "runtime-boot",
        revision: 0,
        requestId: "runtime-ready",
        runId: "runtime-boot",
      } satisfies LivePreviewRuntimeMessage, "*");
    }
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [loadPreviewCartridge]);

  useEffect(() => {
    if (booting || bootError) setBootOverlayVisible(true);
  }, [bootError, booting]);

  const handleLineComplete = useCallback(() => {
    setBootStage("opening");
    setStartupAudioActive(true);
    if (!hasCustomBootAnimation(bootAnimation, bootAssetUrls)) {
      setOpeningCycleComplete(true);
    }
  }, [bootAnimation, bootAssetUrls]);
  const handleOpeningCycleComplete = useCallback(() => {
    setOpeningCycleComplete(true);
  }, []);

  useEffect(() => {
    let accumulated = 0;
    let lastWheelAt = 0;
    let cooldownUntil = 0;
    const thresholdPx = 80;
    const accumulationWindowMs = 180;
    const cooldownMs = 300;

    function normalizedWheelDelta(event: WheelEvent): number {
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
      return event.deltaY;
    }

    function handleRollbackWheel(event: WheelEvent) {
      if (event.defaultPrevented || hasOpenModal() || isFormOrTextInputTarget(event.target)) return;
      if (document.querySelector("[data-runtime-boot-blocking]")) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".settings-content,.history-list,.save-slot-list,.choice-panel,[data-no-rollback]")) return;
      const runtime = useRuntimeStore.getState();
      if (runtime.screen !== "playing" || !runtime.currentGame || runtime.engineState.activeVideo || runtime.isUiHidden) return;

      const now = performance.now();
      if (now < cooldownUntil) return;
      const delta = normalizedWheelDelta(event);
      if (!Number.isFinite(delta) || delta === 0) return;
      if (now - lastWheelAt > accumulationWindowMs || Math.sign(delta) !== Math.sign(accumulated)) {
        accumulated = 0;
      }
      lastWheelAt = now;
      accumulated += delta;
      if (Math.abs(accumulated) < thresholdPx) return;

      const moved = accumulated < 0 ? runtime.rollback() : runtime.rollForward();
      accumulated = 0;
      if (!moved) return;
      cooldownUntil = now + cooldownMs;
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("wheel", handleRollbackWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleRollbackWheel);
  }, []);
  const handleBootAnimationError = useCallback((message: string) => {
    reportFrontendError("player.boot-animation", message, { phase: bootStage });
    setBootError(message);
  }, [bootStage]);
  const handleOpeningAudioError = useCallback((message: string) => {
    const activeScreen = useRuntimeStore.getState().screen;
    recordRuntimeAudio({ phase: "warning", message, screen: activeScreen });
    reportFrontendError("player.opening-audio", message, { phase: "non-blocking-warning" });
  }, []);

  useEffect(() => {
    if (!launchTransitionId) return;
    setLaunchFeedbackVisible(false);
    const timer = window.setTimeout(() => {
      const phase = useRuntimeStore.getState().launchTransition;
      if (phase === "covering" || phase === "preparing") {
        setLaunchFeedbackVisible(true);
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [launchTransitionId]);

  useEffect(() => {
    if (launchTransition !== "arming" || !launchTransitionId) return;
    const frame = window.requestAnimationFrame(() => {
      useRuntimeStore.getState().beginLaunchCover();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [launchTransition, launchTransitionId]);

  useEffect(() => {
    if (launchTransition === "idle" || launchTransition === "revealing") {
      setLaunchFeedbackVisible(false);
    }
  }, [launchTransition]);

  useEffect(() => {
    if (
      !launchTransitionId
      || (launchTransition !== "covering" && launchTransition !== "revealing")
    ) return;
    const timer = window.setTimeout(() => {
      const runtime = useRuntimeStore.getState();
      if (launchTransition === "covering") void runtime.completeLaunchCover();
      else runtime.completeLaunchReveal();
    }, launchTransitionDurationMs + 80);
    return () => window.clearTimeout(timer);
  }, [launchTransition, launchTransitionDurationMs, launchTransitionId]);

  const handleLaunchTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;
    const runtime = useRuntimeStore.getState();
    if (runtime.launchTransition === "covering") {
      void runtime.completeLaunchCover();
    } else if (runtime.launchTransition === "revealing") {
      runtime.completeLaunchReveal();
    }
  }, []);

  const launchFeedbackTitle = launchIntent?.kind === "resume_active"
    ? "正在返回游戏"
    : launchIntent?.kind === "continue_latest"
      ? "正在读取最近存档"
      : launchIntent?.kind === "load_slot"
        ? "正在读取存档"
        : "正在准备开场资源";

  useEffect(() => {
    if (bootStage !== "opening" || !bootReady || !openingCycleComplete || bootError) return;
    if (hasCustomBootAnimation(bootAnimation, bootAssetUrls)) return;
    const timer = window.setTimeout(hideBootOverlay, 320);
    return () => window.clearTimeout(timer);
  }, [bootError, bootReady, bootStage, hideBootOverlay, openingCycleComplete, bootAnimation, bootAssetUrls]);

  return (
    <UISkinProvider>
      <div ref={bootContentRef} className="runtime-boot-content" tabIndex={-1}
        data-runtime-boot-blocking={bootBlocking ? "" : undefined}>
        <RuntimeScreenNavigator loadScreen={preloadRuntimeScreen}
          renderScreen={renderRuntimeScreen} fallback={<RuntimeScreenLoading />} />
      </div>
      <RuntimeAudio />
      {exitConfirmationOpen && <ExitGameDialog />}
      <QuickLoadDialog />
      <SaveMigrationDialog />
      <OpeningAudioPlayer
        game={currentGame}
        tracks={currentGame?.script.opening_audio}
        active={startupAudioActive && !bootError}
        inStory={screen === "playing"}
        onWarning={handleOpeningAudioError}
      />
      {launchTransition !== "idle" && (
        <div
          className={`game-launch-blackout is-${launchTransition}`}
          style={{ "--game-launch-duration": `${launchTransitionDurationMs}ms` } as React.CSSProperties}
          aria-hidden={!launchFeedbackVisible}
          onTransitionEnd={handleLaunchTransitionEnd}
          data-testid="game-launch-blackout"
        >
          <div
            className={`launch-feedback${launchFeedbackVisible ? " is-visible" : ""}`}
            aria-hidden={!launchFeedbackVisible}
            role={launchFeedbackVisible ? "status" : undefined}
            aria-live={launchFeedbackVisible ? "polite" : undefined}
          >
            <BootCircleLoader />
          {launchPreparation && (
            <div className="launch-preparation">
              <strong>{launchFeedbackTitle}</strong>
              <span>
                {(launchPreparation.loadedBytes / 1024 / 1024).toFixed(2)} MiB / {(launchPreparation.totalBytes / 1024 / 1024).toFixed(2)} MiB
                （{launchPreparation.percent}%）
              </span>
              <progress max={100} value={launchPreparation.percent} />
            </div>
          )}
          </div>
        </div>
      )}
      {bootOverlayVisible && !bootError && bootStage === "opening" && bootAnimation
        && hasCustomBootAnimation(bootAnimation, bootAssetUrls) && (
        <OpeningScreen animation={bootAnimation} assetUrls={bootAssetUrls}
          complete={bootReady && openingCycleComplete}
          onCycleComplete={handleOpeningCycleComplete} onComplete={hideBootOverlay}
          onError={handleBootAnimationError} />
      )}
      {bootBlocking && (bootError || bootStage === "line" || !hasCustomBootAnimation(bootAnimation, bootAssetUrls)) && (
        <div className="boot-overlay" role="status" aria-live="polite">
          {bootError ? (
            <ErrorView message={bootError} onRetry={() => window.location.reload()} />
          ) : (
            <>
            <section className="boot-card boot-card-line-only">
              <BootAnimation complete={bootReady}
                onComplete={bootStage === "line" ? handleLineComplete : undefined} />
            </section>
            </>
          )}
        </div>
      )}
    </UISkinProvider>
  );
}
