const statusLabels: Record<string, string> = {
  idle: "空闲",
  unprocessed: "未处理",
  pending: "待处理",
  waiting: "等待中",
  creating: "创建中",
  created: "已创建",
  processing: "处理中",
  running: "运行中",
  paused: "已暂停",
  retrying: "重试中",
  completed: "已完成",
  failed: "失败",
  failed_partial: "部分失败",
  timeout_suspected: "疑似超时",
  skipped: "已跳过",
  cancelled: "已取消",
};

export function novelImportStatusLabel(status?: string | null): string {
  if (!status) return "待处理";
  return statusLabels[status] ?? status;
}
