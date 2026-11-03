import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { OperationState } from "./WorkspacePrimitives";

export function WorkspaceStatusBar() {
  const dirty = useEditorStore((state) => state.dirty);
  const activeGeneration = useEditorStore((state) => state.activeGeneration);
  const notice = useEditorStore((state) => state.lastError);
  const status = activeGeneration ? "正在生成" : dirty ? "有未保存修改" : notice?.tone === "error" ? "需要处理" : "已保存";
  const Icon = activeGeneration ? LoaderCircle : notice?.tone === "error" ? CircleAlert : Check;

  return (
    <footer
      className="workspace-status-bar"
      data-testid="workspace-status-bar"
      data-state={activeGeneration ? "busy" : dirty ? "dirty" : "saved"}
    >
      <OperationState label={status} busy={Boolean(activeGeneration)} />
      <Icon size={14} aria-hidden="true" className={activeGeneration ? "workspace-status-spin" : undefined} />
      <span className="workspace-status-detail">{notice?.message ?? "工程数据与当前编辑器状态保持同步。"}</span>
    </footer>
  );
}
