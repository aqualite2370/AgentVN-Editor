import type { CSSProperties } from "react";
import { EyeOff, History, List, PlaySquare, Save, Settings, SkipForward, Timer } from "lucide-react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { Button } from "../common/Button";

export function PlaybackControls() {
  const isAutoMode = useRuntimeStore((state) => state.engineState.isAutoMode);
  const isSkipMode = useRuntimeStore((state) => state.engineState.isSkipMode);
  const runtimeMode = useRuntimeStore((state) => state.runtimeMode);
  const setUiHidden = useRuntimeStore((state) => state.setUiHidden);
  const toggleAuto = useRuntimeStore((state) => state.toggleAuto);
  const toggleSkip = useRuntimeStore((state) => state.toggleSkip);
  const openSaveLoad = useRuntimeStore((state) => state.openSaveLoad);
  const openSettings = useRuntimeStore((state) => state.openSettings);
  const openHistory = useRuntimeStore((state) => state.openHistory);
  const openMenu = useRuntimeStore((state) => state.openMenu);
  const layout = useUILayoutStyle("player", "quick_menu");
  const itemCount = runtimeMode === "preview" ? 8 : 7;
  const layoutStyle = layout.style;
  const rect = layout.rect;
  const layoutWidthValue = layoutStyle.width ? String(layoutStyle.width) : undefined;
  const layoutHeightValue = layoutStyle.height ? String(layoutStyle.height) : undefined;
  const layoutWidthForSizing = rect?.width
    ? `calc(min(100vw, calc(100vh * 16 / 9)) * ${rect.width / 100})`
    : layoutWidthValue;
  const layoutHeightForSizing = rect?.height
    ? `calc(min(100vh, calc(100vw * 9 / 16)) * ${rect.height / 100})`
    : layoutHeightValue;
  const rightEdge = rect ? rect.x + rect.width : undefined;
  const bottomEdge = rect ? rect.y + rect.height : undefined;
  const alignRight = rect?.anchor === "top_right" || rect?.anchor === "bottom_right" || (rightEdge != null && rightEdge >= 100);
  const alignBottom = rect?.anchor === "bottom_left" || rect?.anchor === "bottom_center" || rect?.anchor === "bottom_right" || (bottomEdge != null && bottomEdge >= 100);
  const quickMenuStyle: CSSProperties = {
    ...layoutStyle,
    left: alignRight ? "auto" : layoutStyle.left,
    right: alignRight && rightEdge != null ? `${Math.max(0, 100 - Math.min(100, rightEdge))}%` : layoutStyle.right,
    top: alignBottom ? "auto" : layoutStyle.top,
    bottom: alignBottom && bottomEdge != null ? `${Math.max(0, 100 - Math.min(100, bottomEdge))}%` : layoutStyle.bottom,
    width: "max-content",
    height: "max-content",
    maxWidth: layoutWidthForSizing,
    maxHeight: layoutHeightForSizing,
    transform: undefined,
    "--runtime-quick-menu-layout-width": layoutWidthForSizing,
    "--runtime-quick-menu-layout-height": layoutHeightForSizing,
    "--runtime-quick-menu-slot-count": String(itemCount),
    "--runtime-quick-menu-gap-count": String(Math.max(0, itemCount - 1)),
  } as CSSProperties;

  const autoLabel = isAutoMode ? "关闭自动播放" : "开启自动播放";
  const skipLabel = isSkipMode ? "关闭快进" : "开启快进";

  return (
    <div
      className={`playback-controls ui-layouted mode-${runtimeMode}`}
      style={quickMenuStyle}
      aria-label="播放快捷菜单"
      data-no-advance="true"
      data-ui-layout-source={layout.layoutSource}
    >
      {runtimeMode === "preview" && (
        <span className="preview-badge" title="预览模式" aria-label="预览模式">
          <PlaySquare size={15} aria-hidden="true" />
        </span>
      )}
      <Button className="icon-button" variant="ghost" active={isAutoMode} aria-label={autoLabel} title={autoLabel} data-tooltip={autoLabel} onClick={toggleAuto}>
        <Timer size={18} aria-hidden="true" />
      </Button>
      <Button className="icon-button" variant="ghost" active={isSkipMode} aria-label={skipLabel} title={skipLabel} data-tooltip={skipLabel} onClick={toggleSkip}>
        <SkipForward size={18} aria-hidden="true" />
      </Button>
      <Button className="icon-button" variant="ghost" aria-label="打开存档读档" title="打开存档读档" data-tooltip="打开存档读档" onClick={openSaveLoad}>
        <Save size={18} aria-hidden="true" />
      </Button>
      <Button className="icon-button" variant="ghost" aria-label="打开历史记录" title="打开历史记录" data-tooltip="打开历史记录" onClick={openHistory}>
        <History size={18} aria-hidden="true" />
      </Button>
      <Button className="icon-button" variant="ghost" aria-label="打开设置" title="打开设置" data-tooltip="打开设置" onClick={openSettings}>
        <Settings size={18} aria-hidden="true" />
      </Button>
      <Button className="icon-button" variant="ghost" aria-label="隐藏界面" title="隐藏界面" data-tooltip="隐藏界面" onClick={() => setUiHidden(true)}>
        <EyeOff size={18} aria-hidden="true" />
      </Button>
      <Button className="icon-button" variant="ghost" aria-label="打开主菜单" title="打开主菜单" data-tooltip="打开主菜单" data-testid="open-main-menu" onClick={openMenu}>
        <List size={18} aria-hidden="true" />
      </Button>
    </div>
  );
}
