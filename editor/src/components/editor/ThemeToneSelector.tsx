import { Moon, SunMedium } from "lucide-react";
import { useThemeStore } from "../../store/themeStore";

export function ThemeToneSelector() {
  const themeTone = useThemeStore((state) => state.themeTone);
  const toggleThemeTone = useThemeStore((state) => state.toggleThemeTone);
  const isLight = themeTone === "white_gray";
  const nextThemeLabel = isLight ? "深色主题" : "浅色主题";

  return (
    <button
      type="button"
      className={`theme-tone-switch ${isLight ? "is-light" : "is-dark"}`}
      aria-label={`切换到${nextThemeLabel}`}
      aria-pressed={isLight}
      data-help-key="toolbar.theme"
      data-help="在深色和浅色主题之间切换。选择会记忆到本机，下次打开编辑器会自动恢复；切换时页面会用柔和过渡慢慢变色。"
      onClick={toggleThemeTone}
    >
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-thumb">
          <SunMedium className="theme-icon theme-icon-sun" size={16} />
          <Moon className="theme-icon theme-icon-moon" size={16} />
        </span>
      </span>
      <span className="theme-switch-label">{isLight ? "浅色" : "深色"}</span>
    </button>
  );
}
