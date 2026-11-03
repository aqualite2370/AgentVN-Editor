import type { AssistantCreationProcess } from "../../assistant/creationProcessQueue";

const activeStatuses = new Set(["queued", "running", "cancelling"]);

function statusLabel(status: AssistantCreationProcess["status"]): string {
  switch (status) {
    case "queued": return "排队中";
    case "running": return "运行中";
    case "cancelling": return "正在取消";
    case "completed": return "已完成";
    case "failed": return "失败";
    case "cancelled": return "已取消";
  }
}

/** Activity is never truncated. Only terminal history has a presentation limit. */
export function AssistantCreationProcessMonitor({ processes, onCancel }: {
  processes: readonly AssistantCreationProcess[];
  onCancel: (id: string) => void;
}) {
  const active = processes.filter(process => activeStatuses.has(process.status))
    .sort((left, right) => left.submittedAt - right.submittedAt);
  const recentHistory = processes.filter(process => !activeStatuses.has(process.status))
    .sort((left, right) => (right.finishedAt ?? right.submittedAt) - (left.finishedAt ?? left.submittedAt))
    .slice(0, 6);
  const queuePositions = new Map(active.filter(process => process.status === "queued")
    .map((process, index) => [process.id, index + 1]));

  return <section className="assistant-process-monitor" aria-label="全局创造进程"
    data-testid="assistant-process-monitor">
    <header>
      <strong>全局创造进程</strong>
      <span>{active.length ? `${active.length} 个进行中` : "暂无进行中的任务"} · 最近 6 条已结束记录</span>
    </header>
    <ol>
      {[...active, ...recentHistory].map(process => {
        const cancellable = process.status === "queued" || process.status === "running";
        const queuePosition = queuePositions.get(process.id);
        return <li key={process.id} data-process-id={process.id} data-status={process.status}>
          <div className="assistant-process-copy">
            <strong title={process.projectTitle || "未命名工程"}>{process.projectTitle || "未命名工程"}</strong>
            <span>{queuePosition ? `排队第 ${queuePosition} 位` : statusLabel(process.status)}</span>
          </div>
          <time dateTime={new Date(process.submittedAt).toISOString()}>
            {new Date(process.submittedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </time>
          {cancellable && <button type="button"
            aria-label={`取消 ${process.projectTitle || "未命名工程"} 的创作进程`}
            onClick={() => onCancel(process.id)}>取消</button>}
          {process.status === "failed" && <details className="assistant-process-error-details">
            <summary>失败详情</summary>
            <p data-testid="assistant-process-error">
              {process.errorCode && <code>{process.errorCode}</code>}
              {process.errorMessage || "任务未成功完成，请查看诊断记录。"}
            </p>
          </details>}
          {Boolean(process.toolEvents?.length) && <details className="assistant-process-error-details"
            data-testid="assistant-agent-tool-timeline">
            <summary>工具调用 · {process.toolEvents!.length} 个事件</summary>
            <ol>{process.toolEvents!.map((event, index) => <li key={`${index}:${event.time}`}>
              <code>{event.tool}</code><span>{event.status}</span>
              <time dateTime={new Date(event.time).toISOString()}>{new Date(event.time).toLocaleTimeString("zh-CN")}</time>
            </li>)}</ol>
          </details>}
        </li>;
      })}
    </ol>
  </section>;
}
