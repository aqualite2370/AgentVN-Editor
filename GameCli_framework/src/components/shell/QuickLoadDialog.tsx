import { useState } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";

export function QuickLoadDialog() {
  const candidate = useRuntimeStore(state => state.quickLoadCandidate);
  const cancel = useRuntimeStore(state => state.cancelQuickLoad);
  const confirm = useRuntimeStore(state => state.confirmQuickLoad);
  const notice = useRuntimeStore(state => state.saveNotice);
  const [pending, setPending] = useState(false);
  if (!candidate) return null;
  async function load() {
    if (pending) return;
    setPending(true);
    try { await confirm(); } finally { setPending(false); }
  }
  return (
    <Modal title="读取最新快存？" onClose={() => { if (!pending) cancel(); }}>
      <p>读取快存会替换当前剧情进度，尚未保存的进度将丢失。</p>
      <p>{new Date(candidate.created_at).toLocaleString()}</p>
      {notice?.status === "error" && <p role="alert">{notice.message}</p>}
      <div className="modal-actions">
        <Button variant="ghost" data-modal-cancel disabled={pending} onClick={cancel}>取消</Button>
        <Button data-testid="confirm-quick-load" loading={pending} onClick={() => void load()}>确认读取</Button>
      </div>
    </Modal>
  );
}
