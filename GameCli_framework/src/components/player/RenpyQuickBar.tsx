import type { CSSProperties } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useRenpyButtonRoleStyle, useRenpyButtonStateStyle, useRuntimeUILayout, useUILayoutFrameSize, useUILayoutSafeBounds, useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { PresentedControl } from "../../uiSkin/PresentedControl";
import { resolveRenpyQuickBar } from "../../../../shared/cartridge/renpyQuickBar";
import "./renpy-quick-bar.css";

export function RenpyQuickBar() {
  const skin = useRuntimeUILayout();
  const frame = useUILayoutFrameSize();
  const safe = useUILayoutSafeBounds();
  const dialog = useUILayoutStyle("player", "dialog_panel");
  const menu = useUILayoutStyle("player", "quick_menu");
  const components = skin.screens.find(screen => screen.screen_id === "player")?.components ?? [];
  const roleStyle = useRenpyButtonRoleStyle("quick_bar", "player", "var(--renpy-quick-scale)");
  const geometry = resolveRenpyQuickBar(frame, safe, roleStyle.enabled
    ? roleStyle.geometry
    : { width: 62, height: 32 });
  const buttonStyle = useRenpyButtonStateStyle(undefined, undefined, geometry.scale);
  const runtime = useRuntimeStore();
  const disabled = runtime.launchTransition !== "idle";
  const actions = [
    { id: "rollback", label: "回退", run: runtime.rollback, disabled: disabled || !runtime.engineState.canRollback },
    { id: "history", label: "历史", run: runtime.openHistory },
    { id: "skip", label: "快进", run: runtime.toggleSkip, active: runtime.engineState.isSkipMode },
    { id: "auto", label: "自动", run: runtime.toggleAuto, active: runtime.engineState.isAutoMode },
    { id: "save-load", label: "存档", run: runtime.openSaveLoad, disabled: disabled || runtime.galleryReplayActive },
    { id: "save", label: "快存", run: () => { void runtime.quickSave().catch(() => undefined); },
      disabled: disabled || runtime.quickSavePending || runtime.galleryReplayActive },
    { id: "load", label: "快读", run: runtime.requestQuickLoad,
      disabled: disabled || runtime.quickSavePending || runtime.galleryReplayActive },
    { id: "settings", label: "设置", run: runtime.openSettings },
    { id: "hide", label: "隐藏", run: () => runtime.setUiHidden(true) },
  ];
  return (
    <PresentedControl layout={skin} component={skin.screens.find(screen => screen.screen_id === "player")?.components.find(component => component.component_type === "quick_menu")}
      assetUrls={runtime.currentGame?.assetUrls} scale={geometry.scale} applyBaseStyle={false}>
    <nav className="playback-controls renpy-quick-bar" data-testid="renpy-quick-bar"
      aria-label="进阶快捷栏" data-no-advance="true" data-save-preview-exclude="true"
      data-uniform-scale={geometry.scale}
      style={{
        backgroundColor: menu.style.backgroundColor, backgroundImage: menu.style.backgroundImage,
        backgroundSize: menu.style.backgroundSize, backgroundPosition: menu.style.backgroundPosition,
        backgroundRepeat: menu.style.backgroundRepeat, borderColor: menu.style.borderColor,
        borderWidth: menu.style.borderWidth, borderRadius: menu.style.borderRadius,
        left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height,
        zIndex: Math.max(30, Number(dialog.style.zIndex) || 30) + 1,
        "--renpy-quick-font": `${geometry.fontSize}px`, "--renpy-quick-gap": `${geometry.gap}px`,
        "--renpy-quick-button-width": `${geometry.buttonWidth}px`, "--renpy-quick-scale": geometry.scale,
      } as CSSProperties}>
      {actions.map(action => {
        const component = components.find(component => component.component_id === ({
          rollback: "quick_rollback_button", history: "quick_history_button", skip: "quick_skip_button",
          auto: "quick_auto_button", "save-load": "quick_save_load_button",
          save: "quick_save_button", load: "quick_load_button", settings: "quick_settings_button",
          hide: "quick_hide_ui_button",
        }[action.id]));
        // A base text color belongs to normal appearance, not every native
        // state. Keep CSS hover/selected/disabled feedback and explicit local
        // state/code overrides while preserving the author's normal color.
        const normalColor = component?.style?.color;
        const presentedComponent = normalColor ? { ...component!, style: { ...component!.style, color: undefined } } : component;
        return (
        <PresentedControl key={action.id} layout={skin}
          component={presentedComponent} assetUrls={runtime.currentGame?.assetUrls} scale={geometry.scale}>
        <button key={action.id} type="button"
          data-testid={`renpy-quick-${action.id}`}
          className={`renpy-quick-action${roleStyle.enabled ? " renpy-role-custom-control" : ""}`}
          data-renpy-role-custom={roleStyle.enabled ? "true" : undefined}
          data-renpy-role-styled={roleStyle.styled ? "true" : undefined}
          data-renpy-role-bordered={roleStyle.bordered ? "true" : undefined}
          data-renpy-role-opacity={roleStyle.opacityConfigured ? "true" : undefined}
          data-renpy-role-state={action.disabled ?? disabled ? "disabled" : action.active ? "selected" : "normal"}
          style={{ ...buttonStyle, ...(roleStyle.enabled ? roleStyle.style : {}),
            ...(normalColor ? { "--renpy-button-text-normal": normalColor,
              "--renpy-role-normal-text": normalColor } : {}) } as CSSProperties}
          aria-pressed={action.active} aria-busy={action.id === "save" && runtime.quickSavePending || undefined}
          disabled={action.disabled ?? disabled} onClick={action.run}>
          {action.label}
        </button>
        </PresentedControl>
      ); })}
    </nav>
    </PresentedControl>
  );
}
