import { AlertTriangle, Bell, CheckCircle2, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorNotice } from "../../store/editorStore";
import { buildErrorReport, getNoticeMessage } from "../../utils/errorReport";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const autoDismissMs = 5000;
const previewMaxLength = 96;
const defaultOpenHint = "点击打开程序旁 error_log 文件夹里的完整错误报告。";
const toneLabels = {
  success: "完成",
  info: "通知",
  warning: "提醒",
  error: "报错",
} as const;

const toneIcons = {
  success: CheckCircle2,
  info: Info,
  warning: Bell,
  error: AlertTriangle,
} as const;

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window || navigator.userAgent.includes("Tauri");
}

function previewNotice(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= previewMaxLength) return compact;
  return `${compact.slice(0, previewMaxLength)}...`;
}

function writeReportWindow(target: Window | null, report: { fileName: string; text: string }): void {
  if (!target) return;
  target.document.open();
  target.document.write(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${report.fileName}</title>
  <style>
    body { margin: 0; padding: 24px; background: #111827; color: #e5e7eb; font: 14px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
    a { color: #67e8f9; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <a id="download" download="${report.fileName}">下载 ${report.fileName}</a>
  <pre></pre>
</body>
</html>`);
  target.document.querySelector("pre")!.textContent = report.text;
  const blobUrl = URL.createObjectURL(new Blob([report.text], { type: "text/plain;charset=utf-8" }));
  const link = target.document.querySelector<HTMLAnchorElement>("#download");
  if (link) link.href = blobUrl;
  target.document.close();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  target.focus();
}

function downloadReport(report: { fileName: string; text: string }): void {
  const blobUrl = URL.createObjectURL(new Blob([report.text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = report.fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

async function openNoticeReport(notice: EditorNotice): Promise<string | undefined> {
  const report = buildErrorReport({ notice });
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("open_error_report", { message: report.text });
  }
  const opened = window.open("", "agentvn-error-report");
  if (opened) {
    writeReportWindow(opened, report);
  } else {
    downloadReport(report);
  }
  return undefined;
}

async function persistNoticeReport(notice: EditorNotice): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined;
  const report = buildErrorReport({ notice });
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("write_error_report", { message: report.text });
}

export function ErrorToast({ notice, onDismiss }: { notice: EditorNotice; onDismiss: () => void }) {
  const message = getNoticeMessage(notice);
  const preview = useMemo(() => previewNotice(message), [message]);
  const dismissRef = useRef(onDismiss);
  const [openHint, setOpenHint] = useState(defaultOpenHint);
  const tone = notice.tone ?? "error";
  const heading = toneLabels[tone];
  const Icon = toneIcons[tone];
  const canOpenReport = tone === "error" && notice.reportable !== false;
  const secondaryText = canOpenReport ? openHint : notice.action;

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (canOpenReport) {
      setOpenHint(defaultOpenHint);
      void persistNoticeReport(notice)
        .then((path) => {
          if (path) setOpenHint(`已导出：${path}。点击打开完整错误报告。`);
        })
        .catch((error) => {
          reportFrontendError("editor.error-report", error, { operation: "persist" });
          const detail = error instanceof Error ? error.message : String(error);
          setOpenHint(`自动导出错误报告失败：${detail}`);
        });
    } else {
      setOpenHint("");
    }
    const timer = window.setTimeout(() => dismissRef.current(), autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [canOpenReport, notice]);

  const content = (
    <>
      <span className="toast-status-icon" aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="toast-status-content">
        <strong>{heading}</strong>
        <span>{preview}</span>
        {secondaryText && <small>{secondaryText}</small>}
      </span>
      <span className="toast-status-progress" aria-hidden="true" />
    </>
  );

  const toast = canOpenReport ? (
    <button
      type="button"
      className={`toast-status is-${tone}`}
      data-help-key="notice.openReport"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void openNoticeReport(notice)
          .then((path) => {
            setOpenHint(path ? `已打开：${path}` : "已打开完整错误报告。");
          })
          .catch((error) => {
            reportFrontendError("editor.error-report", error, { operation: "open" });
            const detail = error instanceof Error ? error.message : String(error);
            setOpenHint(`错误报告打开失败：${detail}`);
          });
      }}
      title={openHint}
      aria-label="打开 AgentVN 完整错误报告"
    >
      {content}
    </button>
  ) : (
    <div
      className={`toast-status is-${tone} is-passive`}
      role={tone === "warning" ? "alert" : "status"}
      aria-live={tone === "warning" ? "assertive" : "polite"}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      {content}
    </div>
  );

  return createPortal(toast, document.body);
}
