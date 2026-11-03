import { useRef, type CSSProperties, type ReactNode } from "react";
import type { QuickMenuButtonComponentId } from "../../../../shared/cartridge/uiSkin";
import { resolveQuickMenuPresentation } from "../../../../shared/cartridge/quickMenuMetrics";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useRuntimeUILayout, useUILayoutComponentStyle, useUILayoutStyle, useUILayoutSafeBounds, useUILayoutFrameSize, useUILayoutFormFactor } from "../../uiSkin/uiSkinRuntime";
import { RenpyQuickBar } from "./RenpyQuickBar";
import { Button } from "../common/Button";
import { PrecisionIcon } from "../common/PrecisionIcon";
import { useNvlPanelRect } from "./useNvlPanelRect";

interface QuickMenuButtonProps {
  componentId: QuickMenuButtonComponentId;
  label: string;
  displayLabel: string;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  tabIndex?: number;
  onClick: () => void;
  children: ReactNode;
  actionIndex?: number;
  uniformScale: number;
}

function QuickMenuButton({
  componentId,
  label,
  displayLabel,
  title = label,
  active,
  disabled,
  testId,
  tabIndex,
  onClick,
  children,
  actionIndex,
  uniformScale,
}: QuickMenuButtonProps) {
  const layout = useUILayoutComponentStyle("player", componentId, "quick_button");
  const authoredStyle = layout.component?.style;
  const hasImageReference = Boolean(layout.component?.style?.backgroundImage);
  const hasResolvedImage = Boolean(layout.style.backgroundImage);
  return (
    <Button
      className={`icon-button quick-menu-button${layout.visualMode === "image_owned" ? " is-image-owned" : ""}${hasImageReference && !hasResolvedImage ? " is-missing-image" : ""}`}
      variant="ghost"
      active={active}
      disabled={disabled}
      aria-label={label}
      title={title}
      data-tooltip={displayLabel}
      data-testid={testId}
      tabIndex={tabIndex}
      data-ui-component-id={componentId}
      data-ui-component-type="quick_button"
      data-ui-layout-source={layout.layoutSource}
      data-ui-frame-mode={layout.visualMode}
      data-ui-image-state={hasImageReference ? (hasResolvedImage ? "resolved" : "missing") : "none"}
      style={{
        ...layout.style,
        "--runtime-quick-menu-action-index": actionIndex ?? 0,
        "--runtime-quick-menu-action-blur": `${(authoredStyle?.backdropBlur ?? 6) * uniformScale}px`,
        "--runtime-quick-menu-action-radius": `${(authoredStyle?.borderRadius ?? 10) * uniformScale}px`,
        "--runtime-quick-menu-action-border-width": `${(authoredStyle?.borderWidth ?? 1) * uniformScale}px`,
      } as CSSProperties}
      onClick={onClick}
    >
      {children}
      <span className="quick-menu-button-label">{displayLabel}</span>
    </Button>
  );
}

interface PlaybackControlsProps {
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function PlaybackControls({ expanded, onToggleExpanded }: PlaybackControlsProps) {
  const skin = useRuntimeUILayout();
  return skin.layout_type === "renpy" ? <RenpyQuickBar />
    : <AgentVNPlaybackControls expanded={expanded} onToggleExpanded={onToggleExpanded} />;
}

function AgentVNPlaybackControls({ expanded, onToggleExpanded }: PlaybackControlsProps) {
  const controlRef = useRef<HTMLDivElement | null>(null);
  const isNvl = useRuntimeStore(state => state.engineState.nvlPresentationMode === "nvl"
    && state.engineState.nvlPage.length > 0);
  const nvlRect = useNvlPanelRect(controlRef, isNvl);
  const isAutoMode = useRuntimeStore((state) => state.engineState.isAutoMode);
  const isSkipMode = useRuntimeStore((state) => state.engineState.isSkipMode);
  const runtimeMode = useRuntimeStore((state) => state.runtimeMode);
  const setUiHidden = useRuntimeStore((state) => state.setUiHidden);
  const toggleAuto = useRuntimeStore((state) => state.toggleAuto);
  const toggleSkip = useRuntimeStore((state) => state.toggleSkip);
  const openSaveLoad = useRuntimeStore((state) => state.openSaveLoad);
  const openHistory = useRuntimeStore((state) => state.openHistory);
  const openMenu = useRuntimeStore((state) => state.openMenu);
  const galleryReplayActive = useRuntimeStore((state) => state.galleryReplayActive);
  const rollback = useRuntimeStore((state) => state.rollback);
  const canRollback = useRuntimeStore((state) => state.engineState.canRollback);
  const layout = useUILayoutStyle("player", "quick_menu");
  const dialogLayout = useUILayoutStyle("player", "dialog_panel");
  const safeBounds = useUILayoutSafeBounds();
  const formFactor = useUILayoutFormFactor();
  const toggleMaterial = useUILayoutComponentStyle("player", "quick_main_menu_button", "quick_button");
  const itemCount = 7;
  const layoutStyle = layout.style;
  // Use the same resolved visual viewport as the rendered layout frame.
  // Android's window.innerWidth can remain stale during surface recovery.
  const authoredFrame = useUILayoutFrameSize();
  const quickMenuVariant = "C" as const;
  const menuDirection = "up" as const;
  const authoredSurfaceStyle = layout.component?.style;
  const authoredToggleStyle = toggleMaterial.component?.style;
  const toggleMaterialStyle = toggleMaterial.style as CSSProperties & Record<string, string | number | undefined>;
  const quickMenuPresentation = resolveQuickMenuPresentation({
    layout: {
      rect: layout.rect,
      style: {
        ...authoredSurfaceStyle,
        quickMenuVariant,
        quickMenuDirection: menuDirection,
      },
      actionStyle: authoredToggleStyle,
    },
    dialogRect: nvlRect ?? dialogLayout.rect,
    authoredFrame,
    dialogueTop: (nvlRect?.y ?? dialogLayout.rect?.y ?? 70.6) / 100 * authoredFrame.height,
    safeInsets: {
      left: safeBounds.x / 100 * authoredFrame.width,
      top: safeBounds.y / 100 * authoredFrame.height,
      right: (100 - safeBounds.x - safeBounds.width) / 100 * authoredFrame.width,
      bottom: (100 - safeBounds.y - safeBounds.height) / 100 * authoredFrame.height,
    },
    viewport: { width: authoredFrame.width, height: authoredFrame.height },
    state: expanded ? "expanded" : "collapsed",
    mobile: formFactor === "handheld",
  });
  const quickMenuMetrics = quickMenuPresentation.actions;
  const quickMenuUniformScale = quickMenuPresentation.uniformScale;
  const quickMenuStyle: CSSProperties = {
    ...layoutStyle,
    position: "absolute",
    left: `${quickMenuPresentation.root.left}px`,
    top: `${quickMenuPresentation.root.top}px`,
    right: "auto",
    bottom: "auto",
    transform: "none",
    // Skin alpha belongs to the material tokens, not the entire interaction
    // root. Applying it here would dim the only collapsed toggle as well as
    // every expanded action.
    opacity: 1,
    // The layout node is the authored quick-menu container.  Keep the
    // container and the visible surface on the same geometry so the drawer
    // does not render as an overflowing second panel anchored to a tiny
    // toggle-sized root.
    width: `${quickMenuPresentation.root.width}px`,
    height: `${quickMenuPresentation.root.height}px`,
    "--runtime-quick-menu-layout-width": `${quickMenuPresentation.root.width}px`,
    "--runtime-quick-menu-layout-height": `${quickMenuPresentation.root.height}px`,
    "--runtime-quick-menu-root-width": `${quickMenuPresentation.root.width}px`,
    "--runtime-quick-menu-root-height": `${quickMenuPresentation.root.height}px`,
    "--runtime-quick-menu-surface-width": `${quickMenuMetrics.surfaceWidth}px`,
    "--runtime-quick-menu-surface-height": `${quickMenuMetrics.surfaceHeight}px`,
    "--runtime-quick-menu-drawer-width": `${quickMenuMetrics.surfaceWidth}px`,
    "--runtime-quick-menu-drawer-height": `${quickMenuMetrics.surfaceHeight}px`,
    "--runtime-quick-menu-toggle-size": `${quickMenuMetrics.toggleHitSize}px`,
    "--runtime-quick-menu-toggle-visual-size": `${quickMenuMetrics.toggleVisualSize}px`,
    "--runtime-quick-menu-toggle-visual-width": `${quickMenuMetrics.toggleVisualWidth}px`,
    "--runtime-quick-menu-toggle-visual-height": `${quickMenuMetrics.toggleVisualHeight}px`,
    "--runtime-quick-menu-action-visual-size": `${quickMenuMetrics.actionVisualSize}px`,
    "--runtime-quick-menu-action-visual-width": `${quickMenuMetrics.actionVisualWidth}px`,
    "--runtime-quick-menu-action-visual-height": `${quickMenuMetrics.actionVisualHeight}px`,
    "--runtime-quick-menu-action-hit-size": `${quickMenuMetrics.actionHitSize}px`,
    "--runtime-quick-menu-cell-width": `${quickMenuMetrics.cellWidth}px`,
    "--runtime-quick-menu-cell-height": `${quickMenuMetrics.cellHeight}px`,
    "--runtime-quick-menu-toggle-cell-column": String(quickMenuMetrics.toggleCell.column),
    "--runtime-quick-menu-toggle-cell-row": String(quickMenuMetrics.toggleCell.row),
    "--runtime-quick-menu-expanded-width": `${quickMenuMetrics.expandedBounds.width}px`,
    "--runtime-quick-menu-expanded-height": `${quickMenuMetrics.expandedBounds.height}px`,
    "--runtime-quick-menu-content-height": `${quickMenuMetrics.contentHeight}px`,
    "--runtime-quick-menu-padding": `${quickMenuMetrics.surfacePadding}px`,
    "--runtime-quick-menu-gap": `${quickMenuMetrics.actionGap}px`,
    "--runtime-quick-menu-toggle-gap": `${quickMenuMetrics.toggleGap}px`,
    "--runtime-quick-menu-columns": String(quickMenuMetrics.columns),
    "--runtime-quick-menu-rows": String(quickMenuMetrics.rows),
    "--runtime-quick-menu-uniform-scale": String(quickMenuMetrics.uniformScale),
    "--runtime-quick-menu-toggle-background": toggleMaterialStyle["--runtime-quick-menu-action-background"] ?? toggleMaterialStyle.backgroundColor,
    "--runtime-quick-menu-toggle-border": toggleMaterialStyle["--runtime-quick-menu-action-border"] ?? toggleMaterialStyle.borderColor,
    "--runtime-quick-menu-toggle-alpha": toggleMaterialStyle["--runtime-quick-menu-action-alpha"] ?? "72%",
    "--runtime-quick-menu-toggle-blur": `${quickMenuPresentation.material.action.backdropBlur}px`,
    "--runtime-quick-menu-toggle-radius": toggleMaterialStyle["--runtime-quick-menu-action-radius"] ?? "10px",
    "--runtime-quick-menu-toggle-color": toggleMaterialStyle.color,
    "--runtime-quick-menu-toggle-border-width": `${quickMenuPresentation.material.action.borderWidth}px`,
    "--runtime-quick-menu-skin-radius": `${quickMenuPresentation.material.surface.borderRadius}px`,
    "--runtime-quick-menu-skin-blur": `${quickMenuPresentation.material.surface.backdropBlur}px`,
    "--runtime-quick-menu-surface-border-width": `${quickMenuPresentation.material.surface.borderWidth}px`,
    "--runtime-quick-menu-c-leading-track": `${32 * quickMenuUniformScale}px`,
    "--runtime-quick-menu-c-icon-track": `${46 * quickMenuUniformScale}px`,
    "--runtime-quick-menu-c-icon-size": `${27 * quickMenuUniformScale}px`,
    "--runtime-quick-menu-toggle-expand-icon-size": `${33 * quickMenuUniformScale}px`,
    "--runtime-quick-menu-toggle-close-icon-size": `${22 * quickMenuUniformScale}px`,
    "--runtime-quick-menu-surface-saturation": "0.5",
    "--runtime-quick-menu-slot-count": String(itemCount),
    "--runtime-quick-menu-gap-count": String(Math.max(0, itemCount - 1)),
  } as unknown as CSSProperties;

  const autoLabel = isAutoMode ? "关闭自动播放" : "开启自动播放";
  const skipLabel = isSkipMode ? "关闭快进" : "开启快进";
  return (
    <div
      ref={controlRef}
      className={`playback-controls ui-layouted mode-${runtimeMode} ${expanded ? "is-expanded" : "is-collapsed"}`}
      style={quickMenuStyle}
      aria-label="播放快捷菜单"
      data-no-advance="true"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      data-quick-menu-anchor={quickMenuPresentation.placement}
      data-quick-menu-direction={quickMenuMetrics.direction}
      data-quick-menu-variant={quickMenuVariant}
      data-quick-menu-breakpoint={quickMenuMetrics.breakpoint}
      data-quick-menu-fixed="true"
      data-quick-menu-authored-x={layout.rect?.x}
      data-quick-menu-authored-y={layout.rect?.y}
      data-quick-menu-authored-width={layout.rect?.width}
      data-quick-menu-authored-height={layout.rect?.height}
      data-quick-menu-authored-anchor={layout.rect?.anchor ?? ""}
      data-quick-menu-compact={quickMenuMetrics.compact ? "true" : "false"}
      data-quick-menu-columns={quickMenuMetrics.columns}
      data-quick-menu-rows={quickMenuMetrics.rows}
      data-quick-menu-container-width={quickMenuMetrics.surfaceWidth}
      data-quick-menu-container-height={quickMenuMetrics.surfaceHeight}
      data-quick-menu-toggle-cell-column={quickMenuMetrics.toggleCell.column}
      data-quick-menu-toggle-cell-row={quickMenuMetrics.toggleCell.row}
      data-quick-menu-expanded-width={quickMenuMetrics.expandedBounds.width}
      data-quick-menu-expanded-height={quickMenuMetrics.expandedBounds.height}
      data-quick-menu-uniform-scale={quickMenuMetrics.uniformScale}
      data-quick-menu-scrollable={quickMenuPresentation.scrollable ? "true" : "false"}
      data-quick-menu-content-height={quickMenuMetrics.contentHeight}
      data-ui-layout-source={quickMenuPresentation.placement === "authored" ? "project-layout" : "dialog-default"}
    >
      <div
        className={`quick-menu-surface ${expanded ? "is-expanded" : "is-collapsed"}`}
        aria-hidden={!expanded}
        aria-expanded={expanded}
      >
        <div className="quick-menu-action-layer" aria-hidden={!expanded}>
          <QuickMenuButton componentId="quick_rollback_button" label="回退" displayLabel="回退" title="回退（滚轮上滑 / PageUp）" disabled={!canRollback} tabIndex={expanded ? undefined : -1} actionIndex={0} uniformScale={quickMenuUniformScale} onClick={rollback}>
            <PrecisionIcon name="rollback" />
          </QuickMenuButton>
          <QuickMenuButton componentId="quick_auto_button" label={autoLabel} displayLabel="自动" active={isAutoMode} tabIndex={expanded ? undefined : -1} actionIndex={1} uniformScale={quickMenuUniformScale} onClick={toggleAuto}>
            <PrecisionIcon name="auto" />
          </QuickMenuButton>
          <QuickMenuButton componentId="quick_skip_button" label={skipLabel} displayLabel="快进" active={isSkipMode} tabIndex={expanded ? undefined : -1} actionIndex={2} uniformScale={quickMenuUniformScale} onClick={toggleSkip}>
            <PrecisionIcon name="skip" />
          </QuickMenuButton>
          <QuickMenuButton componentId="quick_save_load_button" label={galleryReplayActive ? "画廊回放中不可存档" : "打开存档读档"} displayLabel="存档" disabled={galleryReplayActive} tabIndex={expanded ? undefined : -1} actionIndex={3} uniformScale={quickMenuUniformScale} onClick={openSaveLoad}>
            <PrecisionIcon name="save" />
          </QuickMenuButton>
          <QuickMenuButton componentId="quick_history_button" label="打开历史记录" displayLabel="历史" tabIndex={expanded ? undefined : -1} actionIndex={4} uniformScale={quickMenuUniformScale} onClick={openHistory}>
            <PrecisionIcon name="history" />
          </QuickMenuButton>
          <QuickMenuButton componentId="quick_hide_ui_button" label="隐藏界面" displayLabel="隐藏" tabIndex={expanded ? undefined : -1} actionIndex={5} uniformScale={quickMenuUniformScale} onClick={() => setUiHidden(true)}>
            <PrecisionIcon name="hide" />
          </QuickMenuButton>
          <QuickMenuButton componentId="quick_main_menu_button" label={galleryReplayActive ? "返回画廊" : "打开主菜单"} displayLabel="菜单" testId="open-main-menu" tabIndex={expanded ? undefined : -1} actionIndex={6} uniformScale={quickMenuUniformScale} onClick={openMenu}>
            <PrecisionIcon name="menu" />
          </QuickMenuButton>
        </div>
      </div>
      <div className="quick-menu-toggle-layer" aria-hidden={false}>
        <Button
          className="icon-button quick-menu-toggle"
          variant="ghost"
          aria-label={expanded ? "收起快捷菜单" : "展开快捷菜单"}
          aria-expanded={expanded}
          data-testid="quick-menu-toggle"
          data-no-advance="true"
          data-quick-menu-icon={expanded ? "close" : "expand"}
          onClick={onToggleExpanded}
        >
          <span className={`quick-menu-toggle-icon quick-menu-toggle-icon-expand${expanded ? "" : " is-visible"}`} aria-hidden="true">
          <PrecisionIcon name="expand" size={33} />
          </span>
          <span className={`quick-menu-toggle-icon quick-menu-toggle-icon-close${expanded ? " is-visible" : ""}`} aria-hidden="true">
            <PrecisionIcon name="close" size={22} />
          </span>
        </Button>
      </div>
    </div>
  );
}
