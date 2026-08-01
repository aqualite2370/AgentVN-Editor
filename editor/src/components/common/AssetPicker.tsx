import { FolderOpen, ImageIcon, Music, RefreshCw, Search, Sparkles, Type, Video, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  assetCategoryHint,
  assetTypeDisplayLabel,
  assetTypeMatchesExpected,
  semanticCategoryForAssetType,
} from "../../../../shared/cartridge/assetTaxonomy";
import { useProjectStore } from "../../store/projectStore";
import type { AssetRef, AssetType } from "../../types/assets";
import { safeVisibleText } from "../../utils/textSafety";
import { requestAdvancedTools } from "../advanced/advancedToolsBridge";
import { FieldHelp } from "./FieldHelp";
import { assetSlotWarning, resolveAssetSlotGuidance } from "../../utils/assetSlotGuidance";
import { generatedAssetToAssetRef } from "../../utils/projectAssets";
import type { ReferenceImage, SavedGenerationProvenance } from "../../providers/types";

export type AssetPickerType = Extract<
  AssetType,
  "background" | "sprite" | "portrait" | "bgm" | "sfx" | "voice" | "video" | "animation" | "font" | "ui" | "other"
>;

interface AssetPickerProps {
  label: string;
  field: string;
  value: string;
  allowedTypes: AssetPickerType[];
  helpKey: string;
  onChange: (assetId: string, asset?: AssetRef) => void;
  emptyLabel?: string;
  placeholder?: string;
  variant?: "inline" | "popover";
  className?: string;
  disabled?: boolean;
}

interface AssetPickerPopoverPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

function mediaSource(asset: AssetRef): string | undefined {
  const metadata = asset.metadata;
  return metadata.data_url ?? metadata.blob_url ?? metadata.url ?? metadata.path ?? metadata.filePath;
}

function isImageAsset(asset: AssetRef): boolean {
  const mimeType = asset.metadata.mime_type ?? "";
  const source = mediaSource(asset) ?? "";
  return mimeType.startsWith("image/") || source.startsWith("data:image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(asset.metadata.filename ?? source);
}

function isAudioAsset(asset: AssetRef): boolean {
  const mimeType = asset.metadata.mime_type ?? "";
  const source = mediaSource(asset) ?? "";
  return semanticCategoryForAssetType(asset.asset_type) === "audio" || asset.asset_type === "voice" || mimeType.startsWith("audio/") || source.startsWith("data:audio/");
}

function isFontAsset(asset: AssetRef): boolean {
  const mimeType = asset.metadata.mime_type ?? "";
  const source = mediaSource(asset) ?? "";
  return asset.asset_type === "font" || mimeType.startsWith("font/") || /\.(ttf|otf|woff2?)$/i.test(asset.metadata.filename ?? source);
}

function isVideoAsset(asset: AssetRef): boolean {
  const mimeType = asset.metadata.mime_type ?? "";
  const source = mediaSource(asset) ?? "";
  return asset.asset_type === "video" || mimeType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(asset.metadata.filename ?? source);
}

function metadataSearchText(asset: AssetRef): string {
  const metadata = asset.metadata as Record<string, unknown>;
  const dynamicKeys = ["display_name", "character_name", "characterName", "character", "character_id", "name", "speaker", "label"];
  const dynamicValues = dynamicKeys
    .map((key) => metadata[key])
    .filter((item): item is string => typeof item === "string");
  return [
    asset.asset_id,
    assetTypeDisplayLabel(asset.asset_type),
    asset.metadata.filename,
    asset.metadata.license_note,
    asset.metadata.prompt,
    asset.metadata.project_path,
    asset.metadata.path,
    asset.metadata.filePath,
    ...dynamicValues,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function safeAssetFilename(asset: AssetRef): string {
  return safeVisibleText(asset.metadata.filename, `${asset.asset_id}.bin`);
}

function assetDisplayName(asset: AssetRef): string {
  return safeVisibleText(asset.metadata.display_name, safeAssetFilename(asset));
}

function assetSourceLabel(asset: AssetRef): string {
  const filename = safeAssetFilename(asset);
  const licenseNote = safeVisibleText(asset.metadata.license_note);
  const displayName = assetDisplayName(asset);
  return [displayName === filename ? assetTypeDisplayLabel(asset.asset_type) : filename, licenseNote].filter(Boolean).join(" / ");
}

function AssetPreview({ asset }: { asset: AssetRef }) {
  const source = mediaSource(asset);
  if (source && isImageAsset(asset)) return <img src={source} alt={safeAssetFilename(asset)} loading="lazy" />;
  if (source && isVideoAsset(asset)) return <video src={source} muted preload="metadata" />;
  if (isAudioAsset(asset)) return <span className="asset-picker-placeholder" aria-hidden="true"><Music size={18} /></span>;
  if (isFontAsset(asset)) return <span className="asset-picker-placeholder" aria-hidden="true"><Type size={18} /></span>;
  if (isVideoAsset(asset)) return <span className="asset-picker-placeholder" aria-hidden="true"><Video size={18} /></span>;
  return <span className="asset-picker-placeholder" aria-hidden="true"><ImageIcon size={18} /></span>;
}

function uniqueTabs(allowedTypes: AssetPickerType[]): AssetPickerType[] {
  const seen = new Set<string>();
  const tabs: AssetPickerType[] = [];
  for (const assetType of allowedTypes) {
    const category = semanticCategoryForAssetType(assetType);
    if (seen.has(category)) continue;
    seen.add(category);
    tabs.push(assetType);
  }
  return tabs;
}

export function AssetPicker({
  label,
  field,
  value,
  allowedTypes,
  helpKey,
  onChange,
  emptyLabel,
  placeholder,
  variant = "popover",
  className,
  disabled = false,
}: AssetPickerProps) {
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<AssetPickerPopoverPosition>({
    top: 0,
    left: 0,
    width: 520,
    maxHeight: 520,
    placement: "bottom",
  });
  const tabs = useMemo(() => uniqueTabs(allowedTypes), [allowedTypes]);
  const [activeType, setActiveType] = useState<AssetPickerType>(tabs[0] ?? allowedTypes[0] ?? "background");
  const normalizedQuery = query.trim().toLowerCase();
  const selectedAsset = useMemo(() => assetManifest.find((asset) => asset.asset_id === value), [assetManifest, value]);
  const activeLabel = assetTypeDisplayLabel(activeType);
  const selectedTypeAllowed = selectedAsset
    ? allowedTypes.some((allowedType) => assetTypeMatchesExpected(selectedAsset.asset_type, allowedType))
    : true;
  const selectedMissing = Boolean(value && !selectedAsset);
  const guidance = useMemo(() => resolveAssetSlotGuidance(field, allowedTypes), [allowedTypes, field]);
  const dimensionWarning = useMemo(() => assetSlotWarning(selectedAsset, guidance), [guidance, selectedAsset]);
  const usePopover = variant === "popover";

  useEffect(() => {
    if (!tabs.some((assetType) => assetTypeMatchesExpected(activeType, assetType))) {
      setActiveType(tabs[0] ?? allowedTypes[0] ?? "background");
    }
  }, [activeType, allowedTypes, tabs]);

  useEffect(() => setMounted(true), []);

  const typeAssets = useMemo(
    () => assetManifest.filter((asset) => allowedTypes.some((allowedType) => assetTypeMatchesExpected(asset.asset_type, allowedType)) && assetTypeMatchesExpected(asset.asset_type, activeType) && Boolean(asset.asset_id)),
    [activeType, allowedTypes, assetManifest],
  );
  const filteredAssets = useMemo(
    () => (normalizedQuery ? typeAssets.filter((asset) => metadataSearchText(asset).includes(normalizedQuery)) : typeAssets),
    [normalizedQuery, typeAssets],
  );

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportGap = 12;
    const gap = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(rect.width, 320), 520, Math.max(280, viewportWidth - viewportGap * 2));
    const belowSpace = viewportHeight - rect.bottom - viewportGap;
    const aboveSpace = rect.top - viewportGap;
    const placement: AssetPickerPopoverPosition["placement"] = belowSpace < 340 && aboveSpace > belowSpace ? "top" : "bottom";
    const available = Math.max(0, placement === "top" ? aboveSpace : belowSpace);
    const maxHeight = Math.max(220, Math.min(520, available - gap));
    const top = placement === "bottom" ? Math.min(viewportHeight - viewportGap - maxHeight, rect.bottom + gap) : undefined;
    const bottom = placement === "top" ? Math.max(viewportGap, viewportHeight - rect.top + gap) : undefined;
    const left = Math.min(
      Math.max(viewportGap, rect.left),
      Math.max(viewportGap, viewportWidth - width - viewportGap),
    );
    setPopoverPosition({ top, bottom, left, width, maxHeight, placement });
  }, []);

  useLayoutEffect(() => {
    if (!usePopover || !popoverOpen) return;
    updatePopoverPosition();
  }, [filteredAssets.length, popoverOpen, tabs.length, updatePopoverPosition, usePopover]);

  useEffect(() => {
    if (!usePopover || !popoverOpen) return;

    function closePopover(returnFocus = false) {
      setPopoverOpen(false);
      if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closePopover(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePopover(true);
      }
    }

    function handleViewportChange() {
      updatePopoverPosition();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [popoverOpen, updatePopoverPosition, usePopover]);

  function handleSelect(asset: AssetRef) {
    onChange(asset.asset_id, asset);
    setQuery("");
    if (usePopover) {
      setPopoverOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function openLibrary(title: string, message: string) {
    setPopoverOpen(false);
    requestAdvancedTools({ tab: "library", title, message });
  }

  function openAssetStudio(sourceGeneration?: SavedGenerationProvenance) {
    const recommendedAssetType = ["background", "sprite", "portrait", "ui"].includes(activeType)
      ? activeType as "background" | "sprite" | "portrait" | "ui"
      : "background";
    setPopoverOpen(false);
    requestAdvancedTools({
      tab: "assets",
      title: `为“${label}”生成素材`,
      message: "保存时可直接应用到当前素材槽位。",
      assetStudioContext: {
        field,
        recommendedAssetType,
        sourceGeneration,
        sourceImage: selectedAsset && mediaSource(selectedAsset)
          ? {
              image_id: `source_${selectedAsset.asset_id}`,
              source: "project_asset",
              blob_url: mediaSource(selectedAsset)!,
              note: assetDisplayName(selectedAsset),
              weight: 1,
              role: "source",
            } satisfies ReferenceImage
          : undefined,
        onApplyAsset: (record) => {
          const asset = generatedAssetToAssetRef(record);
          onChange(asset.asset_id, asset);
        },
      },
    });
  }
  const selectedGeneration = selectedAsset?.metadata.generation
    && selectedAsset.metadata.generation.version === 1
    && typeof selectedAsset.metadata.generation.prompt === "string"
    ? selectedAsset.metadata.generation as unknown as SavedGenerationProvenance
    : undefined;

  function renderSelectedSummary(asButton: boolean) {
    const summaryLabel = selectedAsset ? assetDisplayName(selectedAsset) : value ? "素材缺失" : (placeholder ?? "尚未选择素材");
    const summaryDetail = selectedMissing
      ? `找不到素材：${value}`
      : selectedAsset && selectedTypeAllowed
        ? assetSourceLabel(selectedAsset)
        : assetCategoryHint(activeType);
    const content = (
      <>
        <span className="asset-picker-selected-copy">
          <strong title={selectedAsset ? selectedAsset.asset_id : value || "尚未选择素材"}>{summaryLabel}</strong>
          <span title={summaryDetail}>{summaryDetail}</span>
        </span>
        {asButton && <span className="asset-picker-open-label"><Search size={14} /> {selectedAsset ? "更换素材" : "选择素材"}</span>}
      </>
    );

    if (asButton) {
      return (
        <button
          ref={triggerRef}
          type="button"
          className={`asset-picker-selected asset-picker-selected-button${popoverOpen ? " is-open" : ""}`}
          data-help-key={`${helpKey}.openPicker`}
          aria-haspopup="dialog"
          aria-expanded={popoverOpen}
          disabled={disabled}
          onClick={() => setPopoverOpen((current) => !current)}
        >
          {content}
        </button>
      );
    }

    return <div className="asset-picker-selected">{content}</div>;
  }

  function renderTypeTabs() {
    if (tabs.length <= 1) return null;
    return (
      <div className="asset-picker-type-tabs" role="tablist" aria-label="素材类型过滤">
        {tabs.map((assetType) => (
          <button
            key={assetType}
            type="button"
            className={assetTypeMatchesExpected(activeType, assetType) ? "is-active" : ""}
            data-help-key={`${helpKey}.type`}
            data-asset-type={assetType}
            role="tab"
            aria-selected={assetTypeMatchesExpected(activeType, assetType)}
            disabled={disabled}
            onClick={() => setActiveType(assetType)}
          >
            {assetTypeDisplayLabel(assetType)}
          </button>
        ))}
      </div>
    );
  }

  function renderSearch() {
    return (
      <label className="asset-picker-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          placeholder={`搜索${activeLabel}素材、文件名、角色名或备注`}
          data-help-key={`${helpKey}.search`}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
    );
  }

  function renderWarnings() {
    return (
      <>
        {!selectedTypeAllowed && selectedAsset && (
          <p className="asset-picker-warning" role="alert">
            当前素材是{assetTypeDisplayLabel(selectedAsset.asset_type)}，不能作为{activeLabel}使用。请在素材库修改类型，或重新选择素材。
          </p>
        )}

        {selectedMissing && (
          <p className="asset-picker-warning" role="alert">
            旧项目引用的素材不存在。请清空后从素材库重新选择。
          </p>
        )}
        {dimensionWarning && <p className="asset-picker-guidance-warning" role="status">{dimensionWarning}</p>}
      </>
    );
  }

  function renderAssetList() {
    return (
      <div className="asset-picker-list" role="list">
        {filteredAssets.map((asset) => {
          const source = mediaSource(asset);
          const selected = asset.asset_id === value;
          const filename = safeAssetFilename(asset);
          const licenseNote = safeVisibleText(asset.metadata.license_note);
          return (
            <article key={asset.asset_id} className={`asset-picker-card${selected ? " is-selected" : ""}`} role="listitem">
              <button
                type="button"
                className="asset-picker-card-main"
                data-help-key={`${helpKey}.select`}
                data-asset-id={asset.asset_id}
                data-asset-type={asset.asset_type}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => handleSelect(asset)}
              >
                <AssetPreview asset={asset} />
                <span className="asset-picker-card-copy">
                  <strong title={asset.asset_id}>{assetDisplayName(asset)}</strong>
                  <small>{assetTypeDisplayLabel(asset.asset_type)} / {filename}</small>
                  {licenseNote && <small title={licenseNote}>{licenseNote}</small>}
                </span>
              </button>
              {source && isAudioAsset(asset) && (
                <audio className="asset-picker-audio" src={source} controls preload="none">
                  当前浏览器不支持音频试听。
                </audio>
              )}
            </article>
          );
        })}
        {filteredAssets.length === 0 && (
          <div className="asset-picker-empty">
            <strong>{emptyLabel ?? `暂无可选${activeLabel}`}</strong>
            <span>{assetCategoryHint(activeType)} 可以先到素材库导入或修改素材类型，再回到这里选择。</span>
            <button type="button" disabled={disabled} data-help-key={`${helpKey}.emptyOpenLibrary`} onClick={() => openLibrary("打开素材库", "导入对应类型素材后，再回到当前编辑器选择。")}>
              <FolderOpen size={14} /> 去素材库
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderPickerBody(includeWarnings = true) {
    return (
      <>
        {renderTypeTabs()}
        {renderSearch()}
        {includeWarnings && renderWarnings()}
        {renderAssetList()}
      </>
    );
  }

  const popover = mounted && usePopover && popoverOpen ? createPortal(
    <div
      ref={popoverRef}
      className={`asset-picker-popover is-${popoverPosition.placement}`}
      data-toolbar-popover-keepopen="true"
      role="dialog"
      aria-label={`${label}选择`}
      style={{
        top: popoverPosition.top,
        bottom: popoverPosition.bottom,
        left: popoverPosition.left,
        width: popoverPosition.width,
        maxHeight: popoverPosition.maxHeight,
      }}
    >
      <header className="asset-picker-popover-header">
        <div>
          <strong>{label}</strong>
          <span>{assetCategoryHint(activeType)}</span>
        </div>
        <button type="button" aria-label="关闭素材选择" title="关闭素材选择" data-help-key="assetPicker.close" onClick={() => setPopoverOpen(false)}>
          <X size={14} />
        </button>
      </header>
      <div className="asset-picker-popover-body">{renderPickerBody(false)}</div>
    </div>,
    document.body,
  ) : null;

  const heading = (
    <div className="asset-picker-heading">
      <span className="asset-picker-heading-copy">
        <span className="asset-picker-label-text">
          {label} <FieldHelp field={field} />
        </span>
        {guidance && <small className="asset-picker-guidance" data-testid="asset-slot-guidance">推荐 {guidance.recommended}</small>}
      </span>
      <span className="asset-picker-actions" role="group" aria-label={`${label}操作`}>
        {["background", "sprite", "portrait", "ui"].includes(activeType) && (
          <button
            type="button"
            disabled={disabled}
            data-help-key="asset.generate"
            title="在素材创作工作台中生成并应用"
            onClick={() => openAssetStudio()}
          >
            <Sparkles size={14} /> AI 生成
          </button>
        )}
        {selectedGeneration && (
          <button
            type="button"
            disabled={disabled}
            data-help-key="asset.generate"
            title="从当前素材的脱敏来源恢复生成参数"
            onClick={() => openAssetStudio(selectedGeneration)}
          >
            <RefreshCw size={14} /> 恢复配方
          </button>
        )}
        <button
          type="button"
          disabled={disabled || !value}
          data-help-key={`${helpKey}.clear`}
          aria-label={`清空${label}`}
          title="清空当前素材"
          onClick={() => onChange("")}
        >
          <X size={14} /> 清空
        </button>
        <button
          type="button"
          disabled={disabled}
          data-help-key={`${helpKey}.openLibrary`}
          title="打开素材库导入素材"
          onClick={() => openLibrary("打开素材库", "先导入或整理素材，再回到这里选择。")}
        >
          <FolderOpen size={14} /> 素材库
        </button>
      </span>
    </div>
  );

  if (usePopover) {
    return (
      <div className={`asset-picker-field is-popover${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
        {heading}
        <div className="asset-picker is-popover-trigger" data-asset-picker-type={activeType}>
          {renderSelectedSummary(true)}
          {renderWarnings()}
        </div>
        {popover}
      </div>
    );
  }

  return (
    <div className={`asset-picker-field${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
      {heading}
      <div className="asset-picker" data-asset-picker-type={activeType}>
        {renderSelectedSummary(false)}
        {renderPickerBody(true)}
      </div>
    </div>
  );
}
