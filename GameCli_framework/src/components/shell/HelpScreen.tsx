import { useContext } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { UISkinScreen, useRuntimeUILayout, useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { UILayoutOpacitySurface } from "../../uiSkin/UILayoutOpacitySurface";
import { ScreenBackButton } from "./ScreenBackButton";
import { RenpyMenuFrame, RenpyMenuManagedContext } from "./RenpyMenuFrame";

/** Help describes shipped inputs only; it never advertises optional hardware. */
export function HelpScreen() {
  const skin = useRuntimeUILayout();
  const managed = useContext(RenpyMenuManagedContext);
  const screen = skin.layout_type === "renpy" ? "help" : "about";
  const layout = useUILayoutStyle(screen, skin.layout_type === "renpy" ? "help_panel" : "about_panel");
  const content = (
      <RenpyMenuFrame activeScreen="help" className="screen-panel help-screen-shell"
        aria-label="帮助" data-testid="help-screen" data-runtime-screen="help">
        <header>
          <ScreenBackButton testId="back-to-player" onClick={() => useRuntimeStore.getState().closeMenu()} />
          <h2>帮助</h2>
        </header>
        <UILayoutOpacitySurface as="section" className="help-card ui-layouted" style={layout.style} presentationComponent={layout.component}>
          <h3>阅读与菜单</h3>
          <p>鼠标点击对白或按空格、Enter 推进；触摸屏轻触对白推进。</p>
          <p>阅读时按 Escape 打开菜单；再次按 Escape 返回游戏。触摸屏可使用画面上的快捷菜单。</p>
          <p>键盘 PageUp 回退已读内容，PageDown 恢复已回退的进度，不会推进未访问剧情；按住 Ctrl 快进，H 隐藏或恢复界面。</p>
          <p>隐藏后可轻触画面、按 H 或 Escape 恢复；这次操作只恢复界面，不推进剧情。隐藏期间自动与快进暂停，恢复后继续原模式。</p>
          <p>存档和读档在菜单中操作。自动播放与快进也可由快捷菜单切换。</p>
        </UILayoutOpacitySurface>
      </RenpyMenuFrame>
  );
  return managed ? content : <UISkinScreen screen={screen}>{content}</UISkinScreen>;
}
