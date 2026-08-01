import { ArrowLeft } from "lucide-react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";

export function HistoryScreen() {
  const history = useRuntimeStore((state) => state.engineState.history);
  const listLayout = useUILayoutStyle("history", "history_list");
  return (
    <main className="screen-panel">
      <header><h2>历史对话</h2><Button aria-label="????" data-testid="back-to-player" onClick={() => useRuntimeStore.getState().closeMenu()}><ArrowLeft size={17} /> 返回游戏</Button></header>
      <div className="history-list ui-layouted" style={listLayout.style}>
        {history.length === 0 ? <EmptyState title="暂无历史" description="推进剧情后，对话记录会出现在这里。" /> : history.map((entry) => (
          <article key={entry.id}>
            <span>{entry.scene_title} / {entry.speaker ?? "旁白"}</span>
            <p>{entry.text}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
