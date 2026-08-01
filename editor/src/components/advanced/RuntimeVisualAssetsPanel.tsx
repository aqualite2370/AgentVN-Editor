import { Image, MonitorPlay, Settings, X } from "lucide-react";
import type { PackageAppearanceSettings } from "../../types/project";
import { backgroundFitOptions } from "../../utils/localizedOptions";
import { AssetPicker } from "../common/AssetPicker";
import { FieldHelp } from "../common/FieldHelp";
import { RangeControl } from "../common/RangeControl";
import { RichSelect } from "../common/RichSelect";

interface RuntimeVisualAssetsPanelProps {
  appearance: PackageAppearanceSettings;
  onChange: (partial: Partial<PackageAppearanceSettings>) => void;
  onClear?: () => void;
  compact?: boolean;
  helpPrefix?: string;
}

export function RuntimeVisualAssetsPanel({
  appearance,
  onChange,
  onClear,
  compact = false,
  helpPrefix = "settings.runtimeVisual",
}: RuntimeVisualAssetsPanelProps) {
  const titleDimming = appearance.titleBackgroundDimming ?? 0.18;
  const settingsDimming = appearance.settingsPanelBackgroundDimming ?? 0.24;

  return (
    <section className={`runtime-visual-assets-panel package-appearance-setting${compact ? " is-compact" : ""}`}>
      <header>
        <div>
          <strong><MonitorPlay size={16} /> 游戏内视觉资源</strong>
          <p>这些资源会写入导出的 `manifest.shell`，供标题页、设置页和设置入口按钮读取。布局与皮肤仍可继续覆盖更细的页面结构。</p>
        </div>
        {onClear && (
          <button type="button" data-help-key={`${helpPrefix}.clear`} onClick={onClear}>
            <X size={16} />
            清空
          </button>
        )}
      </header>

      <div className="runtime-visual-workbench">
        <div className="runtime-visual-group runtime-visual-group-assets">
          {!compact && (
            <AssetPicker
              label="卡带封面"
              field="package.coverAssetId"
              className="runtime-visual-slot runtime-visual-cover"
              value={appearance.coverAssetId ?? ""}
              allowedTypes={["background", "sprite", "portrait", "ui"]}
              helpKey={`${helpPrefix}.cover`}
              emptyLabel="暂无可用封面图片"
              onChange={(coverAssetId) => onChange({ coverAssetId: coverAssetId || undefined })}
            />
          )}

          {!compact && (
            <AssetPicker
              label="卡带图标"
              field="package.iconAssetId"
              className="runtime-visual-slot runtime-visual-icon"
              value={appearance.iconAssetId ?? ""}
              allowedTypes={["ui", "portrait", "sprite"]}
              helpKey={`${helpPrefix}.icon`}
              emptyLabel="暂无可用图标素材"
              onChange={(iconAssetId) => onChange({ iconAssetId: iconAssetId || undefined })}
            />
          )}

          <AssetPicker
            label="独立包图标"
            field="package.standaloneIconAssetId"
            className="runtime-visual-slot runtime-visual-standalone-icon"
            value={appearance.standaloneIconAssetId ?? ""}
            allowedTypes={["ui", "portrait", "sprite", "background"]}
            helpKey={`${helpPrefix}.standaloneIcon`}
            emptyLabel="暂无可用独立包图标"
            onChange={(standaloneIconAssetId) => onChange({ standaloneIconAssetId: standaloneIconAssetId || undefined })}
          />
        </div>

        <section className="runtime-visual-group runtime-visual-group-home" aria-label="标题页视觉资源">
          <div className="runtime-visual-group-heading">
            <strong>标题页</strong>
            <span>主菜单背景与标题页暗度。</span>
          </div>
          <div className="runtime-visual-group-grid">
            <AssetPicker
              label="标题页背景视频"
              field="package.titleBackgroundVideoAssetId"
              className="runtime-visual-slot runtime-visual-home-video"
              value={appearance.titleBackgroundVideoAssetId ?? ""}
              allowedTypes={["video"]}
              helpKey={`${helpPrefix}.homeVideo`}
              emptyLabel="暂无可用标题页视频"
              onChange={(titleBackgroundVideoAssetId) => onChange({ titleBackgroundVideoAssetId: titleBackgroundVideoAssetId || undefined })}
            />

            <AssetPicker
              label="标题页背景"
              field="package.titleBackgroundAssetId"
              className="runtime-visual-slot runtime-visual-home-bg"
              value={appearance.titleBackgroundAssetId ?? ""}
              allowedTypes={["background", "ui"]}
              helpKey={`${helpPrefix}.homeSplash`}
              emptyLabel="暂无可用标题页背景"
              onChange={(titleBackgroundAssetId) => onChange({ titleBackgroundAssetId: titleBackgroundAssetId || undefined })}
            />

            <div className="runtime-visual-fit-control runtime-visual-slot runtime-visual-home-fit">
              <span className="runtime-visual-control-label">
                标题页背景显示模式 <FieldHelp field="package.titleBackgroundFit" />
              </span>
              <RichSelect
                ariaLabel="标题页背景显示模式"
                value={appearance.titleBackgroundFit ?? "stretch"}
                options={backgroundFitOptions}
                helpKey={`${helpPrefix}.homeSplashFit`}
                variant="compact"
                onChange={(titleBackgroundFit) => onChange({ titleBackgroundFit })}
              />
            </div>

            <label className="runtime-visual-fit-control runtime-visual-slot runtime-visual-home-fit">
              <span className="runtime-visual-control-label">标题页背景压暗</span>
              <RangeControl
                min={0}
                max={0.9}
                step={0.01}
                value={titleDimming}
                ariaLabel="标题页背景压暗"
                helpKey={`${helpPrefix}.homeSplashDimming`}
                onChange={(titleBackgroundDimming) => onChange({ titleBackgroundDimming })}
              />
              <output>{Math.round(titleDimming * 100)}%</output>
            </label>
          </div>
        </section>

        <section className="runtime-visual-group runtime-visual-group-settings" aria-label="设置页视觉资源">
          <div className="runtime-visual-group-heading">
            <strong>设置页</strong>
            <span>设置界面背景、入口图片与显示方式。</span>
          </div>
          <div className="runtime-visual-group-grid">
            <AssetPicker
              label="设置页背景"
              field="package.settingsPanelBackgroundAssetId"
              className="runtime-visual-slot runtime-visual-settings-bg"
              value={appearance.settingsPanelBackgroundAssetId ?? ""}
              allowedTypes={["background", "ui"]}
              helpKey={`${helpPrefix}.settingsPanel`}
              emptyLabel="暂无可用设置页背景"
              onChange={(settingsPanelBackgroundAssetId) => onChange({ settingsPanelBackgroundAssetId: settingsPanelBackgroundAssetId || undefined })}
            />

            <div className="runtime-visual-fit-control runtime-visual-slot runtime-visual-settings-fit">
              <span className="runtime-visual-control-label">
                设置页背景显示模式 <FieldHelp field="package.settingsPanelBackgroundFit" />
              </span>
              <RichSelect
                ariaLabel="设置页背景显示模式"
                value={appearance.settingsPanelBackgroundFit ?? "stretch"}
                options={backgroundFitOptions}
                helpKey={`${helpPrefix}.settingsPanelFit`}
                variant="compact"
                onChange={(settingsPanelBackgroundFit) => onChange({ settingsPanelBackgroundFit })}
              />
            </div>

            <label className="runtime-visual-fit-control runtime-visual-slot runtime-visual-settings-fit">
              <span className="runtime-visual-control-label">设置页背景压暗</span>
              <RangeControl
                min={0}
                max={0.9}
                step={0.01}
                value={settingsDimming}
                ariaLabel="设置页背景压暗"
                helpKey={`${helpPrefix}.settingsPanelDimming`}
                onChange={(settingsPanelBackgroundDimming) => onChange({ settingsPanelBackgroundDimming })}
              />
              <output>{Math.round(settingsDimming * 100)}%</output>
            </label>

            <AssetPicker
              label="设置入口图片"
              field="package.settingsEntryImageAssetId"
              className="runtime-visual-slot runtime-visual-settings-entry"
              value={appearance.settingsEntryImageAssetId ?? ""}
              allowedTypes={["ui", "portrait", "sprite"]}
              helpKey={`${helpPrefix}.settingsEntry`}
              emptyLabel="暂无可用设置入口图片"
              onChange={(settingsEntryImageAssetId) => onChange({ settingsEntryImageAssetId: settingsEntryImageAssetId || undefined })}
            />
          </div>
        </section>
      </div>

      <div className="runtime-visual-hints" aria-label="游戏内视觉资源说明">
        <span><Image size={14} /> 标题页背景会成为玩家端主菜单背景。</span>
        <span><MonitorPlay size={14} /> 主页视频推荐 1920×1080、24/30 FPS、MP4 H.264 + AAC、10–30 秒循环且小于 20 MB。</span>
        <span><Settings size={14} /> 设置页背景与设置入口只影响玩家端壳层界面。</span>
      </div>
    </section>
  );
}
