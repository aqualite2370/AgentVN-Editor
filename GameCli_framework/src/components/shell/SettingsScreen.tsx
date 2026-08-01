import { Check, Monitor, RotateCcw, Settings, SkipForward, Type, Volume2, X, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { LibraryGame } from "../../types/cartridge";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { resolveShellBackgroundDimming, shellBackgroundStyle } from "../../utils/backgroundFit";
import { toRuntimeAssetUrl } from "../../utils/runtimeAssetUrl";
import { Button } from "../common/Button";

type SettingsTab = "display" | "text" | "audio" | "skip" | "system";

const tabs: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
  { id: "display", label: "显示", icon: Monitor },
  { id: "text", label: "文字", icon: Type },
  { id: "audio", label: "音频", icon: Volume2 },
  { id: "skip", label: "跳过", icon: SkipForward },
  { id: "system", label: "系统", icon: Settings },
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
  const style = { "--range-progress": rangeProgress(value, min, max) } as CSSProperties;
  return (
    <span className="settings-slider" style={style}>
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </span>
  );
}

export function SettingsScreen() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("display");
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const persistSettings = useSettingsStore((state) => state.persistSettings);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const settingsLayout = useUILayoutStyle("preferences", "settings_group");
  const settingsPanelBackgroundUrl = resolveGameAsset(currentGame, currentGame?.manifest.shell?.settings_panel_background);
  const projectSettingsDimming = resolveShellBackgroundDimming(undefined, currentGame?.manifest.shell?.settings_panel_background_dimming, "settings");
  const shellSettingsStyle: CSSProperties | undefined = settingsPanelBackgroundUrl
      ? shellBackgroundStyle(
        settingsPanelBackgroundUrl,
        currentGame?.manifest.shell?.settings_panel_background_fit,
        projectSettingsDimming,
      )
    : undefined;
  const settingsPanelStyle = mergeSettingsPanelStyle(settingsLayout.style, shellSettingsStyle);

  function finish() {
    persistSettings();
    useRuntimeStore.getState().closeMenu();
  }

  function resetRuntimeSettings() {
    resetSettings();
  }

  return (
    <main className="screen-panel settings-screen">
      <header>
        <h2>设置</h2>
        <Button
          className="icon-button"
          variant="ghost"
          aria-label="关闭设置"
          title="关闭设置"
          data-tooltip="关闭设置"
          data-testid="back-to-main-menu"
          onClick={finish}
        >
          <X size={18} aria-hidden="true" />
        </Button>
      </header>
      <section className={`settings-renpy ui-layouted${settingsPanelBackgroundUrl ? " has-settings-panel-background" : ""}`} style={settingsPanelStyle}>
        <nav className="settings-tabs" aria-label="设置分类">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Button key={tab.id} variant="ghost" active={activeTab === tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
                <Icon size={17} /> {tab.label}
              </Button>
            );
          })}
        </nav>

        <div className="settings-content">
          {activeTab === "display" && (
            <>
              <h3 className="settings-section-title">显示</h3>
              <p className="settings-helper">游戏客户端默认使用全屏窗口模式，不再提供运行时全屏切换。</p>
            </>
          )}

          {activeTab === "text" && (
            <>
              <h3 className="settings-section-title">文字</h3>
              <p className="settings-helper">文字速度越高，打字效果越快。自动播放间隔影响每句停留时间。</p>
              <label className="settings-row">
                <span>文字速度</span>
                <SettingsSlider ariaLabel="Text speed" min={0} max={120} step={2} value={settings.textSpeed} onChange={(textSpeed) => updateSettings({ textSpeed })} />
                <output>{settings.textSpeed === 0 ? "瞬显" : `${settings.textSpeed} cps`}</output>
              </label>
              <label className="settings-row">
                <span>自动播放间隔</span>
                <SettingsSlider ariaLabel="Auto play interval" min={300} max={3000} step={100} value={settings.autoSpeed} onChange={(autoSpeed) => updateSettings({ autoSpeed })} />
                <output>{settings.autoSpeed}ms</output>
              </label>
            </>
          )}

          {activeTab === "audio" && (
            <>
              <h3 className="settings-section-title">音频</h3>
              <p className="settings-helper">分别控制背景音乐、音效和语音音量。</p>
              <label className="settings-row">
                <span>背景音乐</span>
                <SettingsSlider ariaLabel="Background music volume" min={0} max={1} step={0.05} value={settings.volumeBgm} onChange={(volumeBgm) => updateSettings({ volumeBgm })} />
                <output>{formatPercent(settings.volumeBgm)}</output>
              </label>
              <label className="settings-row">
                <span>音效</span>
                <SettingsSlider ariaLabel="Sound effects volume" min={0} max={1} step={0.05} value={settings.volumeSfx} onChange={(volumeSfx) => updateSettings({ volumeSfx })} />
                <output>{formatPercent(settings.volumeSfx)}</output>
              </label>
              <label className="settings-row">
                <span>语音</span>
                <SettingsSlider ariaLabel="Voice volume" min={0} max={1} step={0.05} value={settings.volumeVoice} onChange={(volumeVoice) => updateSettings({ volumeVoice })} />
                <output>{formatPercent(settings.volumeVoice)}</output>
              </label>
            </>
          )}

          {activeTab === "skip" && (
            <>
              <h3 className="settings-section-title">跳过</h3>
              <p className="settings-helper">控制快进是否允许越过未读文本。</p>
              <label className="settings-row">
                <span>跳过未读文本</span>
                <input type="checkbox" aria-label="Skip unread text" checked={settings.skipUnread} onChange={(event) => updateSettings({ skipUnread: event.target.checked })} />
                <small>{settings.skipUnread ? "允许" : "仅已读"}</small>
              </label>
            </>
          )}

          {activeTab === "system" && (
            <>
              <h3 className="settings-section-title">系统</h3>
              <p className="settings-helper">管理自动存档和客户端基础行为。恢复默认会立即覆盖当前设置。</p>
              <label className="settings-row">
                <span>自动存档</span>
                <input type="checkbox" aria-label="自动存档" checked={settings.autoSaveEnabled} onChange={(event) => updateSettings({ autoSaveEnabled: event.target.checked })} />
                <small>{settings.autoSaveEnabled ? "已开启" : "已关闭"}</small>
              </label>
              <div className="settings-row">
                <span>界面语言</span>
                <strong>中文</strong>
                <small>默认</small>
              </div>
              <div className="settings-row">
                <span>恢复默认</span>
                <Button onClick={resetRuntimeSettings}><RotateCcw size={17} /> 恢复默认</Button>
                <small>立即生效</small>
              </div>
            </>
          )}
        </div>

        <footer className="settings-footer">
          <Button onClick={resetRuntimeSettings}><RotateCcw size={17} /> 恢复默认</Button>
          <Button variant="primary" onClick={finish}><Check size={17} aria-hidden="true" /> 完成</Button>
        </footer>
      </section>
    </main>
  );
}
