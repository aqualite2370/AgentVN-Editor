import { useState } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { closeStandaloneRuntimeWindow } from "../../utils/runtimeWindowClose";
import { closeAfterSave, closeWithoutSave } from "../../utils/runtimeExitFlow";
import { useSettingsStore } from "../../store/settingsStore";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";

/** All exit entry points share the same autosave and native-window boundary. */
export function ExitGameDialog() {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const flushAutoSave = useRuntimeStore((state) => state.flushAutoSave);
  const closeExitConfirmation = useRuntimeStore((state) => state.closeExitConfirmation);
  const autoSaveEnabled = useSettingsStore((state) => state.settings.autoSaveEnabled);

  function dismiss() {
    if (!pending) closeExitConfirmation();
  }

  async function confirm() {
    if (pending) return;
    setPending(true);
    setStatus("");
    setSaveFailed(false);
    const result = await closeAfterSave(flushAutoSave, closeStandaloneRuntimeWindow);
    if (result.status === "save-failed") {
      setSaveFailed(true);
      setStatus(`保存失败：${result.message}。游戏仍保持打开。`);
    } else if (result.status === "preview") {
      setStatus("预览模式不会关闭编辑器。");
    } else if (result.status === "failed") {
      setStatus("无法关闭游戏窗口，请重试。");
    }
    setPending(false);
  }

  async function discardAndExit() {
    if (pending) return;
    setPending(true);
    setDiscardConfirmOpen(false);
    const result = await closeWithoutSave(closeStandaloneRuntimeWindow);
    if (result.status === "preview") setStatus("预览模式不会关闭编辑器。");
    if (result.status === "failed") setStatus("无法关闭游戏窗口，请重试。");
    setPending(false);
  }

  return <>
    <Modal title="退出游戏？" onClose={dismiss}>
    <p>{autoSaveEnabled
      ? "退出前会等待自动保存完成；尚未写入存档的进度仍可能丢失。"
      : "自动保存已关闭，本次不会新建自动存档；未保存的进度可能丢失。确认后继续退出。"}
    </p>
    {status && <p className="inline-error runtime-exit-status" role="status">{status}</p>}
    <div className="modal-actions">
      <Button data-modal-initial-focus onClick={dismiss} disabled={pending}>取消</Button>
      {saveFailed ? <>
        {autoSaveEnabled
          ? <Button data-testid="retry-exit-save" loading={pending} onClick={() => void confirm()}>重试保存</Button>
          : <Button data-testid="return-to-save" disabled={pending} onClick={dismiss}>返回游戏重新保存</Button>}
        <Button className="exit-confirm-button" data-testid="discard-exit-save"
          disabled={pending} onClick={() => setDiscardConfirmOpen(true)}>放弃保存并退出</Button>
      </> : <Button className="exit-confirm-button" data-testid="confirm-exit-game"
        loading={pending} onClick={() => void confirm()}>退出游戏</Button>}
    </div>
    </Modal>
    {discardConfirmOpen && <Modal title="确认放弃保存？" onClose={() => setDiscardConfirmOpen(false)}>
      <p>本次游戏进度不会保存。此操作无法撤销，仍要退出吗？</p>
      <div className="modal-actions">
        <Button data-modal-initial-focus onClick={() => setDiscardConfirmOpen(false)}>继续游戏</Button>
        <Button className="exit-confirm-button" data-testid="confirm-discard-exit"
          loading={pending} onClick={() => void discardAndExit()}>确认放弃并退出</Button>
      </div>
    </Modal>}
  </>;
}
