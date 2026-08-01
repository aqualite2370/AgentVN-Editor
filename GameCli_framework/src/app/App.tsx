import "./App.css";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { toJpeg } from "html-to-image";
import { ErrorView } from "../components/common/ErrorView";
import { BootAnimation, BootCircleLoader } from "../components/common/BootAnimation";
import { useLibraryStore } from "../store/libraryStore";
import { useRuntimeStore } from "../store/runtimeStore";
import { setRuntimeWindowTitle } from "../engine/displayMode";
import type { LoadingAnimationConfig } from "../types/script";
import { UISkinProvider, UISkinScreen } from "../uiSkin/uiSkinRuntime";
import { installRuntimeAnimationResidueCleanup } from "../utils/animationResidue";
import { progressiveAssetLoader } from "../engine/progressiveAssetLoader";
import { getLaunchConfig } from "./launchConfig";
import {
  LIVE_PREVIEW_PROTOCOL_VERSION,
  isLivePreviewEditorMessage,
  type LivePreviewEditorMessage,
  type LivePreviewRuntimeMessage,
  type PreviewStartSpec,
} from "../../../shared/preview/livePreviewProtocol";
import type { LibraryGame } from "../types/cartridge";
import { installNativeInteractionGuards } from "../../../shared/ui/nativeInteractionGuards";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

const StoryPlayer = lazy(() => import("../components/player/StoryPlayer").then((module) => ({ default: module.StoryPlayer })));
const AboutScreen = lazy(() => import("../components/shell/AboutScreen").then((module) => ({ default: module.AboutScreen })));
const GalleryScreen = lazy(() => import("../components/shell/GalleryScreen").then((module) => ({ default: module.GalleryScreen })));
const GameLibrary = lazy(() => import("../components/shell/GameLibrary").then((module) => ({ default: module.GameLibrary })));
const HistoryScreen = lazy(() => import("../components/shell/HistoryScreen").then((module) => ({ default: module.HistoryScreen })));
const MainMenu = lazy(() => import("../components/shell/MainMenu").then((module) => ({ default: module.MainMenu })));
const SaveLoadScreen = lazy(() => import("../components/shell/SaveLoadScreen").then((module) => ({ default: module.SaveLoadScreen })));
const SettingsScreen = lazy(() => import("../components/shell/SettingsScreen").then((module) => ({ default: module.SettingsScreen })));

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
}

function livePreviewGame(
  message: Extract<LivePreviewEditorMessage, { type: "agentvn.live-preview.init" }>,
): LibraryGame {
  const now = new Date().toISOString();
  return {
    install_id: "live_preview_gamecli",
    game_id: message.manifest.game_id,
    title: message.manifest.title,
    author: message.manifest.author,
    version: message.manifest.version,
    description: message.manifest.description,
    cover: message.manifest.cover,
    manifest: message.manifest as LibraryGame["manifest"],
    script: message.script as LibraryGame["script"],
    gallery: [],
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
      <strong>正在载入界面</strong>
      <span>播放器和卡带库按功能分块加载。</span>
    </div>
  );
}

export function App() {
  const [bootStatus, setBootStatus] = useState("准备启动 GameCLI 容器...");
  const [bootError, setBootError] = useState<string>();
  const [booting, setBooting] = useState(true);
  const [bootOverlayVisible, setBootOverlayVisible] = useState(true);
  const [bootAnimation, setBootAnimation] = useState<LoadingAnimationConfig>();
  const [bootAssetUrls, setBootAssetUrls] = useState<Record<string, string>>({});
  const initialize = useLibraryStore((state) => state.initialize);
  const screen = useRuntimeStore((state) => state.screen);
  const currentGameTitle = useRuntimeStore((state) => state.currentGame?.title);
  const launchTransition = useRuntimeStore((state) => state.launchTransition);
  const launchTransitionDurationMs = useRuntimeStore((state) => state.launchTransitionDurationMs);
  const launchPreparation = useRuntimeStore((state) => state.launchPreparation);
  const setRuntimeMode = useRuntimeStore((state) => state.setRuntimeMode);
  const loadGame = useRuntimeStore((state) => state.loadGame);
  const hideBootOverlay = useCallback(() => setBootOverlayVisible(false), []);
  const processedPreviewNoncesRef = useRef<string[]>([]);
  const livePreviewRevisionRef = useRef(0);
  const livePreviewActiveRef = useRef(false);
  const livePreviewSessionRef = useRef("");
  const livePreviewRunRef = useRef("");
  const livePreviewStartRef = useRef<PreviewStartSpec>();

  useEffect(() => installRuntimeAnimationResidueCleanup(document), []);
  useEffect(() => installNativeInteractionGuards(document), []);

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


  const loadPreviewCartridge = useCallback(async (cartridgeBuffer: ArrayBuffer, fileName?: string) => {
    setBootError(undefined);
    setBootOverlayVisible(true);
    setBooting(true);
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
      // live-preview protocol uses `preview` and remains strictly read-only.
      setRuntimeMode("fixed");
      await loadGame(game);
      setBootStatus("进入预览标题菜单...");
    } catch (error) {
      reportFrontendError("player.preview-load", error, { fileName });
      setBootError(error instanceof Error ? error.message : String(error));
    } finally {
      setBooting(false);
    }
  }, [loadGame, setRuntimeMode]);

  useEffect(() => {

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isFormOrTextInputTarget(event.target) || hasOpenModal()) return;
      const runtime = useRuntimeStore.getState();
      const hasGame = Boolean(runtime.currentGame);
      const isPlaying = runtime.screen === "playing";
      const hasBlockingVideo = Boolean(runtime.engineState.activeVideo);

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

      if ((event.key === " " || event.key === "Enter") && isPlaying && hasGame && !hasBlockingVideo && runtime.engineState.choices.length === 0 && !runtime.engineState.isWaitingChoice) {
        event.preventDefault();
        runtime.next();
        return;
      }


      if ((event.key === "h" || event.key === "H") && isPlaying && hasGame && !hasBlockingVideo) {
        event.preventDefault();
        runtime.setUiHidden(!runtime.isUiHidden);
        return;
      }

      if (event.key !== "Escape" || !hasGame || hasBlockingVideo) return;
      event.preventDefault();
      event.stopPropagation();
      if (runtime.screen === "playing") runtime.openMenu();
      else if (runtime.screen === "main_menu" || runtime.returnScreen) runtime.closeMenu();
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
        if (config.mode === "library") {
          setBootStatus("读取本地卡带库...");
          await initialize();
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
    function handlePreviewMessage(event: MessageEvent<RuntimePreviewMessage>) {
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
            livePreviewActiveRef.current = true;
            setBootError(undefined);
            setBooting(false);
            setBootOverlayVisible(false);
            setRuntimeMode("preview");
            livePreviewStartRef.current = structuredClone(message.start);
            livePreviewRunRef.current = message.runId;
            runtime.loadLivePreview(livePreviewGame(message), message.start);
            if (message.screen && message.screen !== "playing") runtime.openPreviewScreen(message.screen);
          } else if (message.type === "agentvn.live-preview.start") {
            livePreviewStartRef.current = structuredClone(message.start);
            livePreviewRunRef.current = message.runId;
            runtime.previewStart(message.start);
          } else if (message.type === "agentvn.live-preview.patch") {
            const current = runtime.currentGame;
            if (!current) throw new Error("实时预览尚未初始化。");
            const start = message.start ?? livePreviewStartRef.current;
            if (!start) throw new Error("还没有可用的预览位置，请重新打开预览。");
            livePreviewStartRef.current = structuredClone(start);
            livePreviewRunRef.current = message.runId;
            runtime.loadLivePreview(
              mergeLivePreviewGame(current, message),
              start,
            );
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
      if (event.data?.type === "agentvn.runtime.screen") {
        const screen = event.data.screen;
        if (screen === "title_menu" || screen === "playing" || screen === "settings" || screen === "save_load" || screen === "history" || screen === "gallery" || screen === "about") {
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
        if (screen === "title_menu" || screen === "playing" || screen === "settings" || screen === "save_load" || screen === "history" || screen === "gallery" || screen === "about") {
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

  const content =
    screen === "playing" ? <UISkinScreen screen="player"><StoryPlayer /></UISkinScreen> :
    screen === "library" ? <UISkinScreen screen="game_menu"><GameLibrary /></UISkinScreen> :
    screen === "settings" ? <UISkinScreen screen="preferences"><SettingsScreen /></UISkinScreen> :
    screen === "save_load" ? <UISkinScreen screen="save_load"><SaveLoadScreen /></UISkinScreen> :
    screen === "gallery" ? <UISkinScreen screen="gallery"><GalleryScreen /></UISkinScreen> :
    screen === "history" ? <UISkinScreen screen="history"><HistoryScreen /></UISkinScreen> :
    screen === "about" ? <UISkinScreen screen="about"><AboutScreen /></UISkinScreen> :
    <UISkinScreen screen="title"><MainMenu /></UISkinScreen>;

  return (
    <UISkinProvider>
      <Suspense fallback={<RuntimeScreenLoading />}>
        {content}
      </Suspense>
      {launchTransition !== "idle" && (
        <div
          className={`game-launch-blackout is-${launchTransition}`}
          style={{ "--game-launch-duration": `${launchTransitionDurationMs}ms` } as React.CSSProperties}
          aria-hidden="true"
          data-testid="game-launch-blackout"
        >
          <BootAnimation animation={bootAnimation} assetUrls={bootAssetUrls} />
          {launchPreparation && (
            <div className="launch-preparation" role="status" aria-live="polite">
              <strong>正在准备开场资源</strong>
              <span>
                {(launchPreparation.loadedBytes / 1024 / 1024).toFixed(2)} MiB / {(launchPreparation.totalBytes / 1024 / 1024).toFixed(2)} MiB
                （{launchPreparation.percent}%）
              </span>
              <progress max={100} value={launchPreparation.percent} />
            </div>
          )}
        </div>
      )}
      {(bootOverlayVisible || bootError) && (
        <div className="boot-overlay" role="status" aria-live="polite">
          {bootError ? (
            <ErrorView message={bootError} onRetry={() => window.location.reload()} />
          ) : (
            <section className="boot-card">
              <BootAnimation animation={bootAnimation} assetUrls={bootAssetUrls} complete={!booting} onComplete={hideBootOverlay} />
              <div>
                <span className="panel-kicker">GameCLI Container</span>
                <strong>正在装载卡带</strong>
                <p>{bootStatus}</p>
              </div>
              <progress />
            </section>
          )}
        </div>
      )}
    </UISkinProvider>
  );
}
