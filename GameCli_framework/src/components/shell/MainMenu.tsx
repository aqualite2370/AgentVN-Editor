import { Images, Info, Library, Play, RotateCcw, Save, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UILayoutComponentType } from "../../../../shared/cartridge/uiSkin";
import { useRuntimeStore } from "../../store/runtimeStore";
import type { LibraryGame } from "../../types/cartridge";
import { useUILayoutComponents, useUILayoutComponentStyle, useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { resolveShellBackgroundDimming, shellBackgroundStyle } from "../../utils/backgroundFit";
import { executeUILayoutAction, type ExternalUrlOpenResult } from "../../utils/openExternalUrl";
import { toRuntimeAssetUrl } from "../../utils/runtimeAssetUrl";
import { Button } from "../common/Button";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const titleButtonComponents = {
  continue: { componentId: "title_continue_button", componentType: "main_menu_continue_button" },
  start: { componentId: "title_start_button", componentType: "main_menu_start_button" },
  saveLoad: { componentId: "title_save_load_button", componentType: "main_menu_save_load_button" },
  library: { componentId: "title_library_button", componentType: "main_menu_library_button" },
  gallery: { componentId: "title_gallery_button", componentType: "main_menu_gallery_button" },
  settings: { componentId: "title_settings_button", componentType: "main_menu_settings_button" },
  about: { componentId: "title_about_button", componentType: "main_menu_about_button" },
} as const satisfies Record<string, { componentId: string; componentType: UILayoutComponentType }>;

function resolveGameAsset(game: LibraryGame | undefined, assetId?: string): string | undefined {
  if (!game || !assetId) return undefined;
  const assetPath = game.manifest.assets.find((asset) => asset.asset_id === assetId)?.path;
  return toRuntimeAssetUrl(game.assetUrls[assetId] ?? (assetPath ? game.assetUrls[assetPath] : undefined));
}

export function MainMenu() {
  const [customActionStatus, setCustomActionStatus] = useState("");
  const [titleVideoFailed, setTitleVideoFailed] = useState(false);
  const titleVideoRef = useRef<HTMLVideoElement | null>(null);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const screen = useRuntimeStore((state) => state.screen);
  const saves = useRuntimeStore((state) => state.saves);
  const engineState = useRuntimeStore((state) => state.engineState);
  const runtimeMode = useRuntimeStore((state) => state.runtimeMode);
  const startNewGame = useRuntimeStore((state) => state.startNewGame);
  const launchTransition = useRuntimeStore((state) => state.launchTransition);
  const continueGame = useRuntimeStore((state) => state.continueGame);
  const closeMenu = useRuntimeStore((state) => state.closeMenu);
  const openLibrary = useRuntimeStore((state) => state.openLibrary);
  const openSaveLoad = useRuntimeStore((state) => state.openSaveLoad);
  const openSettings = useRuntimeStore((state) => state.openSettings);
  const openGallery = useRuntimeStore((state) => state.openGallery);
  const openAbout = useRuntimeStore((state) => state.openAbout);
  const heroLayout = useUILayoutStyle("title", "main_menu_hero");
  const continueButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.continue.componentId, titleButtonComponents.continue.componentType);
  const startButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.start.componentId, titleButtonComponents.start.componentType);
  const saveLoadButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.saveLoad.componentId, titleButtonComponents.saveLoad.componentType);
  const libraryButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.library.componentId, titleButtonComponents.library.componentType);
  const galleryButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.gallery.componentId, titleButtonComponents.gallery.componentType);
  const settingsButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.settings.componentId, titleButtonComponents.settings.componentType);
  const aboutButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.about.componentId, titleButtonComponents.about.componentType);
  const customButtonLayouts = useUILayoutComponents("title", "main_menu_custom_button");
  const titleBackgroundUrl = resolveGameAsset(currentGame, currentGame?.manifest.shell?.background);
  const titleBackgroundVideoUrl = resolveGameAsset(currentGame, currentGame?.manifest.shell?.background_video);
  const titleVideoActive = Boolean(titleBackgroundVideoUrl && !titleVideoFailed);
  const titleBackgroundDimming = resolveShellBackgroundDimming(
    undefined,
    currentGame?.manifest.shell?.title_background_dimming,
    "title",
  );
  const shellIconUrl = resolveGameAsset(currentGame, currentGame?.manifest.shell?.icon ?? currentGame?.manifest.cover);
  const settingsEntryUrl = resolveGameAsset(currentGame, currentGame?.manifest.shell?.settings_entry_image);
  const modeLabel = runtimeMode === "preview" ? "预览模式 / 来自编辑器" : runtimeMode === "fixed" ? "固定卡带容器" : "卡带库模式";
  const isTitleMenu = screen === "title_menu";
  const hasSavedProgress = saves.length > 0;
  const hasActiveRun = Boolean(engineState.currentSceneId) && !engineState.isEnded;
  const startLabel = hasSavedProgress || hasActiveRun ? "重新开始" : "开始游戏";

  useEffect(() => {
    setTitleVideoFailed(false);
  }, [currentGame?.install_id, titleBackgroundVideoUrl]);

  useEffect(() => {
    if (!titleVideoActive || !titleVideoRef.current) return;
    const video = titleVideoRef.current;
    video.muted = false;
    void video.play().catch((error) => {
      reportFrontendError("player.title-video", error, {
        operation: "play",
        gameId: currentGame?.game_id,
      });
      setTitleVideoFailed(true);
    });
  }, [titleVideoActive]);

  function actionStatusMessage(result: ExternalUrlOpenResult): string {
    if (result.status === "popup_blocked") return "浏览器阻止了新窗口，请允许弹出窗口后重试。";
    if (result.status === "invalid") return "链接无效，已阻止打开。";
    if (result.status === "failed") return "无法打开链接，请稍后重试。";
    if (result.status === "unsupported_action") return "该按钮操作暂不受支持。";
    return "";
  }

  async function activateCustomButton(action: unknown): Promise<void> {
    const result = await executeUILayoutAction(action);
    setCustomActionStatus(actionStatusMessage(result));
  }

  return (
    <main
      className={`main-menu mode-${runtimeMode}${titleBackgroundUrl || titleVideoActive ? " has-cartridge-background" : ""}${titleVideoActive ? " has-active-video" : ""}`}
      aria-label="主菜单"
      data-testid={isTitleMenu ? "game-state-title" : "main-menu"}
      data-runtime-state={screen}
      style={shellBackgroundStyle(titleBackgroundUrl, currentGame?.manifest.shell?.background_fit, titleBackgroundDimming)}
    >
      {titleVideoActive && (
        <video
          ref={titleVideoRef}
          className="main-menu-background-video"
          src={titleBackgroundVideoUrl}
          autoPlay
          loop
          playsInline
          preload="auto"
          style={{ objectFit: currentGame?.manifest.shell?.background_fit === "stretch" ? "fill" : currentGame?.manifest.shell?.background_fit ?? "cover" }}
          aria-hidden="true"
          onError={(event) => {
            reportFrontendError("player.title-video", "标题背景视频无法加载。", {
              operation: "load",
              gameId: currentGame?.game_id,
              mediaErrorCode: event.currentTarget.error?.code,
            });
            setTitleVideoFailed(true);
          }}
        />
      )}
      {(titleBackgroundUrl || titleVideoActive) && <div className="main-menu-cartridge-bg" aria-hidden="true" />}
      <span className="visually-hidden" role="status" aria-live="polite" data-testid="custom-title-action-status">
        {customActionStatus}
      </span>
      <section className="menu-hero ui-layouted" style={heroLayout.style}>
        <span>{modeLabel}</span>
        {shellIconUrl && <img className="main-menu-cartridge-icon" src={shellIconUrl} alt="" aria-hidden="true" />}
        <h1>{currentGame?.title ?? "GameCLI Player"}</h1>
        <p>{currentGame?.description ?? "从本地卡带库启动视觉小说。每张卡带拥有独立存档、历史和画廊记录。"}</p>
      </section>
      <nav className="menu-actions ui-layouted menu-actions-individual" aria-label="主菜单操作" data-testid="main-menu-actions">
        {!isTitleMenu && hasActiveRun && (
          <Button className="menu-action-button" style={continueButtonLayout.style} variant="primary" aria-label="继续游戏" data-testid="continue-game" data-ui-component-id={titleButtonComponents.continue.componentId} data-ui-layout-source={continueButtonLayout.layoutSource} onClick={closeMenu} disabled={!currentGame}>
            <Play size={20} /> 继续游戏
          </Button>
        )}
        {isTitleMenu && hasSavedProgress && (
          <Button className="menu-action-button" style={continueButtonLayout.style} variant="primary" aria-label="继续游戏" data-testid="continue-game" data-ui-component-id={titleButtonComponents.continue.componentId} data-ui-layout-source={continueButtonLayout.layoutSource} onClick={() => void continueGame()} disabled={!currentGame}>
            <Play size={20} /> 继续游戏
          </Button>
        )}
        <Button
          className="menu-action-button"
          style={startButtonLayout.style}
          variant={hasSavedProgress || hasActiveRun ? "secondary" : "primary"}
          aria-label={startLabel}
          data-testid="start-new-game"
          data-ui-component-id={titleButtonComponents.start.componentId}
          data-ui-layout-source={startButtonLayout.layoutSource}
          onClick={startNewGame}
          disabled={!currentGame || launchTransition !== "idle"}
        >
          {hasSavedProgress || hasActiveRun ? <RotateCcw size={20} /> : <Play size={20} />} {startLabel}
        </Button>
        <Button className="menu-action-button" style={saveLoadButtonLayout.style} aria-label="打开存档和读档" data-testid="open-save-load" data-ui-component-id={titleButtonComponents.saveLoad.componentId} data-ui-layout-source={saveLoadButtonLayout.layoutSource} onClick={openSaveLoad} disabled={!currentGame}>
          <Save size={18} /> 存档 / 读档
        </Button>
        {runtimeMode === "library" && (
          <Button className="menu-action-button" style={libraryButtonLayout.style} aria-label="打开卡带库" data-testid="open-library" data-ui-component-id={titleButtonComponents.library.componentId} data-ui-layout-source={libraryButtonLayout.layoutSource} onClick={openLibrary}>
            <Library size={18} /> 卡带库
          </Button>
        )}
        <Button className="menu-action-button" style={galleryButtonLayout.style} aria-label="打开画廊" data-testid="open-gallery" data-ui-component-id={titleButtonComponents.gallery.componentId} data-ui-layout-source={galleryButtonLayout.layoutSource} onClick={openGallery} disabled={!currentGame}>
          <Images size={18} /> 画廊
        </Button>
        <Button className="menu-action-button" style={settingsButtonLayout.style} aria-label="打开设置" data-testid="open-settings" data-ui-component-id={titleButtonComponents.settings.componentId} data-ui-layout-source={settingsButtonLayout.layoutSource} onClick={openSettings}>
          {settingsEntryUrl ? <img className="settings-entry-image" src={settingsEntryUrl} alt="" aria-hidden="true" /> : <Settings size={18} />}
          设置
        </Button>
        <Button className="menu-action-button" style={aboutButtonLayout.style} aria-label="打开关于" data-testid="open-about" data-ui-component-id={titleButtonComponents.about.componentId} data-ui-layout-source={aboutButtonLayout.layoutSource} onClick={openAbout}>
          <Info size={18} /> 关于
        </Button>
        {customButtonLayouts
          .filter(({ component }) => component.visible !== false)
          .map(({ component, style, layoutSource, visualMode }, index) => {
            const label = component.label?.trim() || `自定义按钮 ${index + 1}`;
            const hasImageReference = Boolean(component.style?.backgroundImage);
            const hasResolvedImage = Boolean(style.backgroundImage);
            return (
              <Button
                key={component.component_id}
                className={`menu-action-button custom-title-button${hasResolvedImage ? " has-background-image" : ""}${visualMode === "image_owned" ? " is-image-owned" : ""}${hasImageReference && !hasResolvedImage ? " is-missing-image" : ""}`}
                style={style}
                aria-label={label}
                data-testid="custom-title-button"
                data-ui-component-id={component.component_id}
                data-ui-component-type={component.component_type}
                data-ui-layout-source={layoutSource}
                data-ui-frame-mode={visualMode}
                data-ui-image-state={hasImageReference ? (hasResolvedImage ? "resolved" : "missing") : "none"}
                data-ui-action-kind={component.action?.kind ?? "none"}
                onClick={() => void activateCustomButton(component.action)}
              >
                <span className="custom-title-button-label">{label}</span>
              </Button>
            );
          })}
      </nav>
    </main>
  );
}
