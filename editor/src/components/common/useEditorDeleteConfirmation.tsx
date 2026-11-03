import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { OperationResultDialog } from "./OperationResultDialog";

/** Never rely on window.confirm: Tauri overrides it with an async plugin call. */
export function useEditorDeleteConfirmation() {
  const [message, setMessage] = useState<string>();
  const resolver = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  const decision = useRef(false);
  useEffect(() => () => {
    resolver.current?.(false);
    resolver.current = undefined;
  }, []);
  const requestDeleteConfirmation = useCallback((text: string): Promise<boolean> => {
    if (resolver.current) return Promise.resolve(false);
    decision.current = false;
    return new Promise(resolve => {
      resolver.current = resolve;
      setMessage(text);
    });
  }, []);
  const dismiss = useCallback(() => {
    const resolve = resolver.current;
    resolver.current = undefined;
    setMessage(undefined);
    resolve?.(decision.current);
  }, []);
  const deleteConfirmation = <OperationResultDialog
    open={message !== undefined}
    tone="warning"
    label="删除确认"
    title="确认删除？"
    message={message ?? ""}
    icon={<Trash2 size={20} />}
    testId="editor-delete-confirmation"
    confirmLabel="取消"
    closeAriaLabel="取消删除"
    inertBackground
    reducedMotionDurationMs={120}
    contextAction={{ label: "确认删除", dismissOnClick: true, onClick: () => { decision.current = true; } }}
    onDismiss={dismiss}
  />;
  return { requestDeleteConfirmation, deleteConfirmation };
}
