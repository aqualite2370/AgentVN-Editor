import { useRuntimeStore } from "../../store/runtimeStore";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { UILayoutOpacitySurface } from "../../uiSkin/UILayoutOpacitySurface";
import { ScreenBackButton } from "./ScreenBackButton";
import { EmptyState } from "../common/EmptyState";
import { RenpyMenuFrame } from "./RenpyMenuFrame";

export function HistoryScreen() {
  const history = useRuntimeStore((state) => state.engineState.history);
  const listLayout = useUILayoutStyle("history", "history_list");
  return (
    <RenpyMenuFrame activeScreen="history" className="screen-panel">
      <header><ScreenBackButton testId="back-to-player" label="返回游戏" onClick={() => useRuntimeStore.getState().closeMenu()} /><h2>历史对话</h2></header>
      <UILayoutOpacitySurface className="history-list ui-layouted" style={listLayout.style} presentationComponent={listLayout.component}>
        {history.length === 0 ? <EmptyState title="暂无历史" description="推进剧情后，对话记录会出现在这里。" /> : history.map((entry) => (
          <article key={entry.id}>
            <span>{entry.scene_title} / {entry.speaker ?? "旁白"}</span>
            <p>{entry.text}</p>
          </article>
        ))}
      </UILayoutOpacitySurface>
    </RenpyMenuFrame>
  );
}
