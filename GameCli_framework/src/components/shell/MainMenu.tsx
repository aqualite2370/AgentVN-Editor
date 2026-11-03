import { useEffect, useRef, useState } from "react";
import { resolveTitleButtonLabel, type UILayoutComponentType } from "../../../../shared/cartridge/uiSkin";
import { useRuntimeStore } from "../../store/runtimeStore";
import type { LibraryGame } from "../../types/cartridge";
import { fontFamilyForAsset, useRuntimeUILayout, useUILayoutComponents, useUILayoutComponentStyle, useUILayoutMasks, useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { PresentedControl } from "../../uiSkin/PresentedControl";
import { RenpyTitleView, type RenpyTitleAction } from "./RenpyTitleView";
import { resolveShellBackgroundDimming, shellBackgroundStyle } from "../../utils/backgroundFit";
import { executeUILayoutAction, type ExternalUrlOpenResult } from "../../utils/openExternalUrl";
import { toRuntimeAssetUrl } from "../../utils/runtimeAssetUrl";
import { Button } from "../common/Button";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const titleButtonComponents = {
  continue: { componentId: "title_continue_button", componentType: "main_menu_continue_button" },
  start: { componentId: "title_start_button", componentType: "main_menu_start_button" },
  saveLoad: { componentId: "title_save_load_button", componentType: "main_menu_save_load_button" },
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
  const skin = useRuntimeUILayout();
  const [customActionStatus, setCustomActionStatus] = useState("");
  const [titleVideoFailed, setTitleVideoFailed] = useState(false);
  const titleVideoRef = useRef<HTMLVideoElement | null>(null);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const screen = useRuntimeStore((state) => state.screen);
  const saves = useRuntimeStore((state) => state.saves);
  const engineState = useRuntimeStore((state) => state.engineState);
  const runtimeMode = useRuntimeStore((state) => state.runtimeMode);
  const presentationMode = useRuntimeStore((state) => state.presentationMode);
  const startNewGame = useRuntimeStore((state) => state.startNewGame);
  const launchTransition = useRuntimeStore((state) => state.launchTransition);
  const continueGame = useRuntimeStore((state) => state.continueGame);
  const resumeActiveGame = useRuntimeStore((state) => state.resumeActiveGame);
  const openSaveLoad = useRuntimeStore((state) => state.openSaveLoad);
  const openSettings = useRuntimeStore((state) => state.openSettings);
  const openGallery = useRuntimeStore((state) => state.openGallery);
  const openAbout = useRuntimeStore((state) => state.openAbout);
  const openHelp = useRuntimeStore((state) => state.openHelp);
  const openExitConfirmation = useRuntimeStore((state) => state.openExitConfirmation);
  const heroLayout = useUILayoutStyle("title", "main_menu_hero");
  const titleMasks = useUILayoutMasks("title");
  const continueButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.continue.componentId, titleButtonComponents.continue.componentType);
  const startButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.start.componentId, titleButtonComponents.start.componentType);
  const saveLoadButtonLayout = useUILayoutComponentStyle("title", titleButtonComponents.saveLoad.componentId, titleButtonComponents.saveLoad.componentType);
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
  const modeLabel = runtimeMode === "preview" ? "预览模式 / 来自编辑器" : runtimeMode === "fixed" ? "固定卡带容器" : "卡带库模式";
  const showRuntimeModeLabel = presentationMode !== "release";
  const isTitleMenu = screen === "title_menu";
  const hasSavedProgress = saves.length > 0;
  const hasActiveRun = Boolean(engineState.currentSceneId) && !engineState.isEnded;
  const startLabel = hasSavedProgress || hasActiveRun ? "重新开始" : "开始游戏";
  const continueButtonLabel = resolveTitleButtonLabel(
    titleButtonComponents.continue.componentType,
    continueButtonLayout.component?.label,
    "继续游戏",
  );
  const startButtonLabel = resolveTitleButtonLabel(
    titleButtonComponents.start.componentType,
    startButtonLayout.component?.label,
    startLabel,
  );
  const saveLoadButtonLabel = resolveTitleButtonLabel(
    titleButtonComponents.saveLoad.componentType,
    saveLoadButtonLayout.component?.label,
    "存档",
  );
  const galleryButtonLabel = resolveTitleButtonLabel(
    titleButtonComponents.gallery.componentType,
    galleryButtonLayout.component?.label,
    "画廊",
  );
  const settingsButtonLabel = resolveTitleButtonLabel(
    titleButtonComponents.settings.componentType,
    settingsButtonLayout.component?.label,
    "设置",
  );
  const aboutButtonLabel = resolveTitleButtonLabel(
    titleButtonComponents.about.componentType,
    aboutButtonLayout.component?.label,
    "关于",
  );
  const continueButtonAriaLabel = resolveTitleButtonLabel(
    titleButtonComponents.continue.componentType,
    continueButtonLayout.component?.label,
    "继续游戏",
  );
  const startButtonAriaLabel = resolveTitleButtonLabel(
    titleButtonComponents.start.componentType,
    startButtonLayout.component?.label,
    startLabel,
  );
  const saveLoadButtonAriaLabel = resolveTitleButtonLabel(
    titleButtonComponents.saveLoad.componentType,
    saveLoadButtonLayout.component?.label,
    "打开存档",
  );
  const galleryButtonAriaLabel = resolveTitleButtonLabel(
    titleButtonComponents.gallery.componentType,
    galleryButtonLayout.component?.label,
    "打开画廊",
  );
  const settingsButtonAriaLabel = resolveTitleButtonLabel(
    titleButtonComponents.settings.componentType,
    settingsButtonLayout.component?.label,
    "打开设置",
  );
  const aboutButtonAriaLabel = resolveTitleButtonLabel(
    titleButtonComponents.about.componentType,
    aboutButtonLayout.component?.label,
    "打开关于",
  );
  const hasHeroBackground = Boolean(
    heroLayout.style.backgroundImage
      || heroLayout.style.backgroundColor
      || heroLayout.style.background,
  );
  const hasConfiguredTitleArtwork = Boolean(
    titleBackgroundUrl
      || titleVideoActive
      || heroLayout.style.backgroundImage,
  );
  const heroBackgroundStyle = {
    ...heroLayout.style,
    ...(heroLayout.style["--ui-layout-background-opacity" as keyof typeof heroLayout.style] !== undefined
      ? { opacity: Number(heroLayout.style["--ui-layout-background-opacity" as keyof typeof heroLayout.style]) } : {}),
    // The hero background is a visual layer for the authored frame, not a
    // separately positioned content card. Some legacy layouts contain a
    // decorative hero rect larger than 100%; on Android that leaked outside
    // the 16:9 frame after resume. Always cover the frame exactly.
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    right: undefined,
    bottom: undefined,
    zIndex: 1,
    pointerEvents: "none" as const,
  };
  const heroContentStyle = {
    ...heroLayout.style,
    ...(heroLayout.style["--ui-layout-content-opacity" as keyof typeof heroLayout.style] !== undefined
      ? { opacity: Number(heroLayout.style["--ui-layout-content-opacity" as keyof typeof heroLayout.style]) } : {}),
    zIndex: 10,
    ...(hasHeroBackground ? {
      backgroundColor: "transparent",
      backgroundImage: "none",
      backgroundSize: undefined,
      backgroundRepeat: undefined,
      backgroundPosition: undefined,
    } : {}),
  };

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

  if (skin.layout_type === "renpy") {
    const disabled = !currentGame || launchTransition !== "idle";
    const actions: RenpyTitleAction[] = [];
    const add = (id: string, label: string, onClick: () => void, visible = true) => {
      if (visible) actions.push({ id, label, onClick, disabled });
    };
    add("continue-game", continueButtonLabel,
      () => { void (isTitleMenu ? continueGame() : resumeActiveGame()); },
      (isTitleMenu ? hasSavedProgress : hasActiveRun) && continueButtonLayout.component?.visible !== false);
    add("start-new-game", startButtonLabel, startNewGame, startButtonLayout.component?.visible !== false);
    add("open-save-load", saveLoadButtonLabel, openSaveLoad, saveLoadButtonLayout.component?.visible !== false);
    add("open-gallery", galleryButtonLabel, openGallery,
      Boolean(currentGame?.gallery.length) && galleryButtonLayout.component?.visible !== false);
    add("open-settings", settingsButtonLabel, openSettings, settingsButtonLayout.component?.visible !== false);
    add("open-about", aboutButtonLabel, openAbout, aboutButtonLayout.component?.visible !== false);
    add("open-help", "帮助", openHelp);
    add("open-exit-confirmation", "退出", openExitConfirmation);
    for (const { component } of customButtonLayouts) {
      add(component.component_id, component.label || "自定义按钮",
        () => { void activateCustomButton(component.action); }, component.visible !== false);
    }
    return <main className="renpy-title-host" aria-label="主菜单"
      data-testid={isTitleMenu ? "game-state-title" : "main-menu"} data-runtime-state={screen}>
      <RenpyTitleView skin={skin} title={currentGame?.title ?? "视觉小说"} version={currentGame?.version}
        contentOpacity={heroLayout.component?.style?.contentOpacity}
        actions={actions} fontFamily={fontFamilyForAsset(skin.tokens.fontAssetId)}
        buttonAssetUrls={currentGame?.assetUrls}
        backgroundFit={currentGame?.manifest.shell?.background_fit}
        backgroundDimming={titleBackgroundUrl || titleVideoActive ? titleBackgroundDimming : 0}
        background={<>
          {titleVideoActive
            ? <video ref={titleVideoRef} src={titleBackgroundVideoUrl} autoPlay loop playsInline
                onError={() => setTitleVideoFailed(true)} />
            : titleBackgroundUrl && <img src={titleBackgroundUrl} alt="" />}
          {hasHeroBackground && <div className="main-menu-title-hero-background" style={heroBackgroundStyle} />}
          {titleMasks.map(({ component, style }) => <PresentedControl key={component.component_id}
            layout={skin} component={component} assetUrls={currentGame?.assetUrls} applyBaseStyle={false}>
            <div className="main-menu-title-mask" style={style} data-ui-mask-id={component.component_id} />
          </PresentedControl>)}
        </>} />
      <span className="visually-hidden" role="status">{customActionStatus}</span>
    </main>;
  }

  return (
    <main
      className={`main-menu mode-${runtimeMode}${titleBackgroundUrl || titleVideoActive ? " has-cartridge-background" : ""}${titleVideoActive ? " has-active-video" : ""}`}
      aria-label="主菜单"
      data-testid={isTitleMenu ? "game-state-title" : "main-menu"}
      data-runtime-state={screen}
      data-presentation-mode={presentationMode}
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
      {hasHeroBackground && (
        <div className="main-menu-title-hero-background" aria-hidden="true" style={heroBackgroundStyle} />
      )}
      {titleMasks.map(({ component, style }, index) => (
        <PresentedControl key={component.component_id} layout={skin} component={component}
          assetUrls={currentGame?.assetUrls} applyBaseStyle={false}>
        <div
          className="main-menu-title-mask"
          aria-hidden="true"
          data-ui-mask-id={component.component_id}
          style={{ ...style, zIndex: Math.min(Math.max(component.zIndex ?? 20, 20) + index, 29) }}
        />
        </PresentedControl>
      ))}
      <span className="visually-hidden" role="status" aria-live="polite" data-testid="custom-title-action-status">
        {customActionStatus}
      </span>
      <section className="menu-hero ui-layouted" style={heroContentStyle}>
        {showRuntimeModeLabel && <span data-runtime-mode-label>{modeLabel}</span>}
        {!hasConfiguredTitleArtwork && shellIconUrl && <img className="main-menu-cartridge-icon" src={shellIconUrl} alt="" aria-hidden="true" />}
        {!hasConfiguredTitleArtwork && <h1>{currentGame?.title ?? "视觉小说"}</h1>}
        {!hasConfiguredTitleArtwork && <p>{currentGame?.description ?? "选择一部作品并开始阅读。"}</p>}
      </section>
      <div className="main-menu-title-actions-layer">
        <nav className="menu-actions ui-layouted menu-actions-individual" aria-label="主菜单操作" data-testid="main-menu-actions"
          style={{ opacity: heroLayout.component?.style?.contentOpacity }}>
        {!isTitleMenu && hasActiveRun && (
          <Button className="menu-action-button title-text-button" style={continueButtonLayout.style} variant="primary" aria-label={continueButtonAriaLabel} data-testid="continue-game" data-ui-component-id={titleButtonComponents.continue.componentId} data-ui-layout-source={continueButtonLayout.layoutSource} onClick={() => void resumeActiveGame()} disabled={!currentGame || launchTransition !== "idle"} aria-busy={launchTransition !== "idle"}>
            <span className="menu-action-label">{continueButtonLabel}</span>
          </Button>
        )}
        {isTitleMenu && hasSavedProgress && (
          <Button className="menu-action-button title-text-button" style={continueButtonLayout.style} variant="primary" aria-label={continueButtonAriaLabel} data-testid="continue-game" data-ui-component-id={titleButtonComponents.continue.componentId} data-ui-layout-source={continueButtonLayout.layoutSource} onClick={() => void continueGame()} disabled={!currentGame || launchTransition !== "idle"} aria-busy={launchTransition !== "idle"}>
            <span className="menu-action-label">{continueButtonLabel}</span>
          </Button>
        )}
        <Button
          className="menu-action-button title-text-button"
          style={startButtonLayout.style}
          variant={hasSavedProgress || hasActiveRun ? "secondary" : "primary"}
          aria-label={startButtonAriaLabel}
          data-testid="start-new-game"
          data-ui-component-id={titleButtonComponents.start.componentId}
          data-ui-layout-source={startButtonLayout.layoutSource}
          onClick={startNewGame}
          disabled={!currentGame || launchTransition !== "idle"}
          aria-busy={launchTransition !== "idle"}
        >
          <span className="menu-action-label">{startButtonLabel}</span>
        </Button>
        <Button className="menu-action-button title-text-button" style={saveLoadButtonLayout.style} aria-label={saveLoadButtonAriaLabel} data-testid="open-save-load" data-ui-component-id={titleButtonComponents.saveLoad.componentId} data-ui-layout-source={saveLoadButtonLayout.layoutSource} onClick={openSaveLoad} disabled={!currentGame || launchTransition !== "idle"}>
          <span className="menu-action-label">{saveLoadButtonLabel}</span>
        </Button>
        <Button className="menu-action-button title-text-button" style={galleryButtonLayout.style} aria-label={galleryButtonAriaLabel} data-testid="open-gallery" data-ui-component-id={titleButtonComponents.gallery.componentId} data-ui-layout-source={galleryButtonLayout.layoutSource} onClick={openGallery} disabled={!currentGame || launchTransition !== "idle"}>
          <span className="menu-action-label">{galleryButtonLabel}</span>
        </Button>
        <Button className="menu-action-button title-text-button" style={settingsButtonLayout.style} aria-label={settingsButtonAriaLabel} data-testid="open-settings" data-ui-component-id={titleButtonComponents.settings.componentId} data-ui-layout-source={settingsButtonLayout.layoutSource} onClick={openSettings} disabled={!currentGame || launchTransition !== "idle"}>
          <span className="menu-action-label">{settingsButtonLabel}</span>
        </Button>
        <Button className="menu-action-button title-text-button" style={aboutButtonLayout.style} aria-label={aboutButtonAriaLabel} data-testid="open-about" data-ui-component-id={titleButtonComponents.about.componentId} data-ui-layout-source={aboutButtonLayout.layoutSource} onClick={openAbout} disabled={!currentGame || launchTransition !== "idle"}>
          <span className="menu-action-label">{aboutButtonLabel}</span>
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
      </div>
    </main>
  );
}
