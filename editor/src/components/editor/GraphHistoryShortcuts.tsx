import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { editorProjectOwner, ownsEditorProject } from "../../utils/editorProjectPersistence";
import { OperationResultDialog } from "../common/OperationResultDialog";
import { describeGraphChange } from "../../utils/graphHistoryDescription";

export function GraphHistoryShortcuts({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const pending = useRef<{
    owner: ReturnType<typeof editorProjectOwner>;
    history: ReturnType<typeof useEditorStore.getState>["graphHistory"];
    confirmed: boolean;
  } | undefined>(undefined);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!active || event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input,textarea,select,[contenteditable],[role='textbox'],[inert]")) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      const undo = key === "z" && !event.shiftKey;
      const redo = key === "y" || (key === "z" && event.shiftKey);
      if (!undo && !redo) return;
      event.preventDefault();
      const state = useEditorStore.getState();
      if (redo) {
        if (!state.redoGraphChange()) state.setNotice("没有可重做的操作。", "info");
        return;
      }
      if (pending.current) return;
      const previous = state.graphHistory.past[state.graphHistory.past.length - 1];
      if (!previous) { state.setNotice("没有可撤销的操作。", "info"); return; }
      pending.current = { owner: editorProjectOwner(), history: state.graphHistory, confirmed: false };
      setDescription(describeGraphChange(previous, state));
      setOpen(true);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active]);
  const dismiss = () => {
    const request = pending.current;
    pending.current = undefined;
    setOpen(false);
    if (!request?.confirmed || !active) return;
    if (!ownsEditorProject(request.owner) || useEditorStore.getState().graphHistory !== request.history) {
      useEditorStore.getState().setNotice("内容已变化，本次撤销未执行。", "warning");
      return;
    }
    useEditorStore.getState().undoGraphChange();
  };
  return <OperationResultDialog open={open} tone="warning" label="撤销"
    title="撤销上一步操作？" message={`即将撤销：${description}。可按 Ctrl+Y 重做。`}
    icon={<Undo2 size={20} />} testId="editor-undo-confirmation" confirmLabel="取消"
    closeAriaLabel="取消撤销" inertBackground reducedMotionDurationMs={120}
    contextAction={{ label: "确认撤销", dismissOnClick: true, onClick: () => {
      if (pending.current) pending.current.confirmed = true;
    } }} onDismiss={dismiss} />;
}
