import { useEffect, useState } from "react";
import { listenPreviewPayload } from "./previewBridge";
import type { PreviewPayload } from "./previewStore";

export function RuntimePreviewRoute() {
  const [payload, setPayload] = useState<PreviewPayload | undefined>();
  useEffect(() => listenPreviewPayload(setPayload), []);
  return (
    <main className="runtime-preview-route">
      <section className="mock-stage">
        <strong>播放预览</strong>
        <span>{(payload?.script as { title?: string } | undefined)?.title ?? "等待编辑器发送预览数据"}</span>
        <span>{payload ? "预览数据已就绪" : "暂无预览内容"}</span>
      </section>
      {payload && (
        <section className="debug-data-preview">
          <strong>调试信息</strong>
          <p>预览窗口已收到当前剧情数据。内部字段已隐藏，不会写入正式导出文件。</p>
        </section>
      )}
    </main>
  );
}
