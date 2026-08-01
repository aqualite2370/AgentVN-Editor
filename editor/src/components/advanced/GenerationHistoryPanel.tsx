import type { GenerationHistoryEntry } from "../../providers/types";

const requestTypeLabels: Record<string, string> = {
  image_generation: "图像生成",
  prompt_rewrite: "提示词优化",
  animation_planning: "动画规划",
};

const statusLabels: Record<string, string> = {
  success: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function GenerationHistoryPanel({ history }: { history: GenerationHistoryEntry[] }) {
  return (
    <section className="advanced-card generation-history-panel ai-glow-surface">
      <h3>生成历史</h3>
      {history.map((item) => (
        <article className="advanced-list-item ai-history-item" key={item.history_id}>
          <strong>{requestTypeLabels[item.request_type] ?? "生成任务"} · {statusLabels[item.status] ?? "已记录"}</strong>
          <span>使用模型：{item.model}</span>
          <p>{item.prompt_preview}</p>
        </article>
      ))}
    </section>
  );
}
