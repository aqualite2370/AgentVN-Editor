import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { LibraryGame } from "../../types/cartridge";
import { useRenpyButtonRoleStyle, useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { UILayoutOpacitySurface } from "../../uiSkin/UILayoutOpacitySurface";
import { resolveShellBackgroundDimming, shellBackgroundStyle } from "../../utils/backgroundFit";
import { toRuntimeAssetUrl } from "../../utils/runtimeAssetUrl";
import { Button } from "../common/Button";
import { PrecisionIcon, type PrecisionIconName } from "../common/PrecisionIcon";
import { RenpyMenuFrame } from "./RenpyMenuFrame";
import { useSettingsContentTransition } from "./useSettingsContentTransition";
import { GAME_ASPECT_RATIOS, resolveGameViewport } from "../../../../shared/cartridge/gameViewport";

type SettingsTab = "display" | "text" | "audio" | "skip" | "system";

const tabs: Array<{ id: SettingsTab; label: string; icon: PrecisionIconName }> = [
  { id: "display", label: "显示", icon: "display" },
  { id: "text", label: "文字", icon: "text" },
  { id: "audio", label: "音频", icon: "audio" },
  { id: "skip", label: "跳过", icon: "skip" },
  { id: "system", label: "系统", icon: "settings" },
];

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function rangeProgress(value: number, min: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return "0%";
  const progress = ((value - min) / (max - min)) * 100;
  return `${Math.max(0, Math.min(100, progress))}%`;
}

function resolveGameAsset(game: LibraryGame | undefined, assetId?: string): string | undefined {
  if (!game || !assetId) return undefined;
  const assetPath = game.manifest.assets.find((asset) => asset.asset_id === assetId)?.path;
  return toRuntimeAssetUrl(game.assetUrls[assetId] ?? (assetPath ? game.assetUrls[assetPath] : undefined));
}

function mergeSettingsPanelStyle(layoutStyle: CSSProperties | undefined, shellStyle: CSSProperties | undefined): CSSProperties | undefined {
  if (!shellStyle) return layoutStyle;
  const {
    background: _background,
    backgroundImage: _backgroundImage,
    backgroundSize: _backgroundSize,
    backgroundRepeat: _backgroundRepeat,
    backgroundPosition: _backgroundPosition,
    backgroundColor: _backgroundColor,
    ...layoutWithoutBackground
  } = layoutStyle ?? {};
  return { ...layoutWithoutBackground, ...shellStyle };
}

function SettingsSlider({
  value,
  min,
  max,
  step,
  ariaLabel,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  const [isInteracting, setIsInteracting] = useState(false);
  const pointerActiveRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const percent = Math.round(((value - min) / Math.max(1, max - min)) * 100);
  const style = {
    "--range-progress": rangeProgress(value, min, max),
    "--range-label": `"${percent}%"`,
  } as CSSProperties;

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const scheduleHide = () => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setIsInteracting(false);
      hideTimerRef.current = null;
    }, 850);
  };

  const isAdjustmentKey = (event: KeyboardEvent<HTMLInputElement>) =>
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key);

  useEffect(() => () => clearHideTimer(), []);

  return (
    <span className={`settings-slider${isInteracting ? " is-interacting" : ""}`} style={style}>
      <span className="settings-slider-track" aria-hidden="true">
        <span className="settings-slider-fill" />
      </span>
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={(event) => {
          clearHideTimer();
          pointerActiveRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsInteracting(true);
        }}
        onPointerUp={(event) => {
          pointerActiveRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setIsInteracting(false);
        }}
        onPointerCancel={() => {
          pointerActiveRef.current = false;
          setIsInteracting(false);
        }}
        onKeyDown={(event) => {
          if (!isAdjustmentKey(event)) return;
          clearHideTimer();
          setIsInteracting(true);
        }}
        onKeyUp={(event) => {
          if (isAdjustmentKey(event)) scheduleHide();
        }}
        onBlur={() => {
          clearHideTimer();
          pointerActiveRef.current = false;
          setIsInteracting(false);
        }}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value));
          if (!pointerActiveRef.current) {
            setIsInteracting(true);
            scheduleHide();
          }
        }}
      />
    </span>
  );
}

export function SettingsScreen() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("display");
  const { contentRef, select: selectTab } = useSettingsContentTransition(activeTab, setActiveTab);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const persistSettings = useSettingsStore((state) => state.persistSettings);
  const openExitConfirmation = useRuntimeStore((state) => state.openExitConfirmation);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const settingsLayout = useUILayoutStyle("preferences", "settings_group");
  const categoryRole = useRenpyButtonRoleStyle("category_pagination", "preferences", "var(--renpy-menu-scale)");
  const settingsPanelBackgroundUrl = resolveGameAsset(currentGame, currentGame?.manifest.shell?.settings_panel_background);
  const projectSettingsDimming = resolveShellBackgroundDimming(undefined, currentGame?.manifest.shell?.settings_panel_background_dimming, "settings");
  const shellSettingsStyle: CSSProperties | undefined = settingsPanelBackgroundUrl
      ? shellBackgroundStyle(
        settingsPanelBackgroundUrl,
        currentGame?.manifest.shell?.settings_panel_background_fit,
        projectSettingsDimming,
      )
    : undefined;
  const settingsPanelStyle = {
    ...mergeSettingsPanelStyle(settingsLayout.style, shellSettingsStyle),
    ...(categoryRole.enabled ? {
      "--settings-category-envelope": `calc(${categoryRole.geometry.width + 20}px * var(--renpy-menu-scale))`,
    } : {}),
  } as CSSProperties;

  function finish() {
    persistSettings();
    useRuntimeStore.getState().closeMenu();
  }

  function resetRuntimeSettings() {
    resetSettings();
  }

  return (
    <RenpyMenuFrame activeScreen="settings" className="screen-panel settings-screen" data-testid="settings-screen">
      <UILayoutOpacitySurface as="section" className={`settings-renpy ui-layouted${settingsPanelBackgroundUrl ? " has-settings-panel-background" : ""}`} style={settingsPanelStyle} presentationComponent={settingsLayout.component}>
        <nav className="settings-tabs" aria-label="设置分类">
          {tabs.map((tab) => {
            return (
              <Button key={tab.id} variant="ghost" active={activeTab === tab.id}
                className={`${activeTab === tab.id ? "is-active" : ""}${categoryRole.enabled ? " renpy-role-custom-control" : ""}`}
                data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
                data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
                data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
                data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
                data-renpy-role-state={activeTab === tab.id ? "selected" : "normal"}
                style={categoryRole.enabled ? categoryRole.style : undefined}
                onClick={() => selectTab(tab.id)}>
                <PrecisionIcon name={tab.icon} size={18} /> {tab.label}
              </Button>
            );
          })}
        </nav>

        <div className="settings-content">
          <div ref={contentRef} className="settings-category-content" data-settings-tab-current={activeTab} tabIndex={-1}>
          {activeTab === "display" && (
            <>
              <h3 className="settings-section-title">显示</h3>
              <p className="settings-helper">调整画面与文字显示方式。桌面客户端默认使用全屏窗口模式。</p>
              <div className="settings-row settings-aspect-row">
                <span id="settings-game-aspect-label">画面比例</span>
                <div className="settings-aspect-options" role="group" aria-labelledby="settings-game-aspect-label">
                  {(["default", ...GAME_ASPECT_RATIOS] as const).map((ratio) => (
                    <Button key={ratio} variant="ghost" active={settings.gameAspectRatio === ratio}
                      aria-pressed={settings.gameAspectRatio === ratio}
                      data-testid={`settings-aspect-${ratio}`}
                      onClick={() => updateSettings({ gameAspectRatio: ratio })}>
                      {ratio === "default" ? `工程默认（${resolveGameViewport(currentGame?.uiSkin?.gameViewport).aspectRatio}）` : ratio}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="settings-row">
                <span>字体大小</span>
                <SettingsSlider ariaLabel="Font scale" min={0.75} max={2} step={0.05} value={settings.fontScale} onChange={(fontScale) => updateSettings({ fontScale })} />
                <output>{formatPercent(settings.fontScale)}</output>
              </label>
              <label className="settings-row">
                <span>行距</span>
                <SettingsSlider ariaLabel="Line spacing" min={0.8} max={2} step={0.05} value={settings.lineSpacing} onChange={(lineSpacing) => updateSettings({ lineSpacing })} />
                <output>{formatPercent(settings.lineSpacing)}</output>
              </label>
              <label className="settings-row">
                <span>高对比度文字</span>
                <input type="checkbox" aria-label="High contrast text" checked={settings.highContrastText} onChange={(event) => updateSettings({ highContrastText: event.target.checked })} />
              </label>
            </>
          )}

          {activeTab === "text" && (
            <>
              <h3 className="settings-section-title">文字</h3>
              <p className="settings-helper">0 表示关闭自动前进。</p>
              <label className="settings-row">
                <span>文字速度</span>
                <SettingsSlider ariaLabel="Text speed" min={0} max={200} step={2} value={settings.textSpeedCps} onChange={(textSpeedCps) => updateSettings({ textSpeedCps, textSpeed: textSpeedCps })} />
                <output>{settings.textSpeedCps === 0 ? "瞬显" : `${settings.textSpeedCps} cps`}</output>
              </label>
              <label className="settings-row">
                <span>自动前进时间</span>
                <SettingsSlider ariaLabel="Auto forward time" min={0} max={30} step={0.5} value={settings.autoForwardTime} onChange={(autoForwardTime) => updateSettings({ autoForwardTime })} />
                <output>{settings.autoForwardTime === 0 ? "手动" : `${settings.autoForwardTime}s/250字`}</output>
              </label>
              <label className="settings-row">
                <span>点击后继续自动播放</span>
                <input type="checkbox" aria-label="Auto forward after click" checked={settings.autoForwardAfterClick} onChange={(event) => updateSettings({ autoForwardAfterClick: event.target.checked })} />
              </label>
            </>
          )}

          {activeTab === "audio" && (
            <>
              <h3 className="settings-section-title">音频</h3>
              <p className="settings-helper">分别调整音乐、音效和语音。</p>
              <label className="settings-row">
                <span>主音量</span>
                <SettingsSlider ariaLabel="Master volume" min={0} max={1} step={0.05} value={settings.volumeMaster} onChange={(volumeMaster) => updateSettings({ volumeMaster })} />
                <output>{formatPercent(settings.volumeMaster)}</output>
              </label>
              <div className="settings-row settings-audio-row">
                <span>背景音乐</span>
                <SettingsSlider ariaLabel="Background music volume" min={0} max={1} step={0.05} value={settings.volumeBgm} onChange={(volumeBgm) => updateSettings({ volumeBgm })} />
                <label className="settings-check"><input type="checkbox" aria-label="Mute background music" checked={settings.muteBgm} onChange={(event) => updateSettings({ muteBgm: event.target.checked })} /><span>静音</span></label>
              </div>
              <div className="settings-row settings-audio-row">
                <span>音效</span>
                <SettingsSlider ariaLabel="Sound effects volume" min={0} max={1} step={0.05} value={settings.volumeSfx} onChange={(volumeSfx) => updateSettings({ volumeSfx })} />
                <label className="settings-check"><input type="checkbox" aria-label="Mute sound effects" checked={settings.muteSfx} onChange={(event) => updateSettings({ muteSfx: event.target.checked })} /><span>静音</span></label>
              </div>
              <div className="settings-row settings-audio-row">
                <span>语音</span>
                <SettingsSlider ariaLabel="Voice volume" min={0} max={1} step={0.05} value={settings.volumeVoice} onChange={(volumeVoice) => updateSettings({ volumeVoice })} />
                <label className="settings-check"><input type="checkbox" aria-label="Mute voice" checked={settings.muteVoice} onChange={(event) => updateSettings({ muteVoice: event.target.checked })} /><span>静音</span></label>
              </div>
              <label className="settings-row">
                <span>全部静音</span>
                <input type="checkbox" aria-label="Mute all" checked={settings.muteAll} onChange={(event) => updateSettings({ muteAll: event.target.checked })} />
              </label>
            </>
          )}

          {activeTab === "skip" && (
            <>
              <h3 className="settings-section-title">跳过</h3>
              <p className="settings-helper">设置快进时可以跳过的内容。</p>
              <label className="settings-row">
                <span>跳过未读文本</span>
                <input type="checkbox" aria-label="Skip unread text" checked={settings.skipUnread} onChange={(event) => updateSettings({ skipUnread: event.target.checked })} />
                <small>{settings.skipUnread ? "允许" : "仅已读"}</small>
              </label>
              <label className="settings-row">
                <span>选项后继续快进</span>
                <input type="checkbox" aria-label="Skip after choices" checked={settings.skipAfterChoices} onChange={(event) => updateSettings({ skipAfterChoices: event.target.checked })} />
              </label>
            </>
          )}

          {activeTab === "system" && (
            <>
              <h3 className="settings-section-title">系统</h3>
              <p className="settings-helper">管理存档。</p>
              <label className="settings-row">
                <span>自动存档</span>
                <input type="checkbox" aria-label="自动存档" checked={settings.autoSaveEnabled} onChange={(event) => updateSettings({ autoSaveEnabled: event.target.checked })} />
              </label>
              <div className="settings-row">
                <span>界面语言</span>
                <strong>中文</strong>
              </div>
            </>
          )}
          </div>
        </div>

        <footer className="settings-footer">
          <div className="settings-footer-actions">
            <Button
              className="settings-exit-link"
              variant="ghost"
              aria-label="退出游戏"
              title="退出游戏"
              data-testid="open-exit-confirmation"
              onClick={openExitConfirmation}
            >
              退出游戏
            </Button>
            <Button data-testid="settings-reset-default" onClick={resetRuntimeSettings}>
              <PrecisionIcon name="reset" size={18} /> 恢复默认
            </Button>
          </div>
          <Button data-testid="settings-finish" variant="primary" onClick={finish}>
            <PrecisionIcon name="check" size={18} /> 完成
          </Button>
        </footer>
      </UILayoutOpacitySurface>
    </RenpyMenuFrame>
  );
}
