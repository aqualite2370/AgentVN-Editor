import { useLayoutEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";
import type { RuntimeLayoutType } from "../../../../shared/cartridge/uiLayoutProfiles";
import { OperationResultDialog } from "../common/OperationResultDialog";

export function RuntimeLayoutTypeControls({ activeType, dirty, disabled, canSave, onSwitch, advancedEnabled = false, onAdvancedChange }: {
  activeType: RuntimeLayoutType;
  dirty: boolean;
  disabled: boolean;
  canSave: boolean;
  onSwitch: (type: RuntimeLayoutType, saveDraft: boolean) => Promise<void>;
  advancedEnabled?: boolean;
  onAdvancedChange?: (enabled: boolean) => void;
}) {
  const [target, setTarget] = useState<RuntimeLayoutType>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLButtonElement | undefined>(undefined);
  useLayoutEffect(() => {
    if (busy || disabled || target || !restoreFocus.current) return;
    const button = restoreFocus.current;
    restoreFocus.current = undefined;
    if (!button.isConnected || button.disabled
      || button.closest('[inert], [hidden], [aria-hidden="true"]')) return;
    // Native disabled/inert state blurs the trigger during the async save.
    // Restore only that lost focus; a user's newer focus owner wins.
    if (document.activeElement === document.body || document.activeElement === button) {
      button.focus({ preventScroll: true });
    }
  }, [busy, disabled, target]);
  async function commit(type: RuntimeLayoutType, saveDraft: boolean) {
    if (pending.current) return;
    const focused = document.activeElement;
    if (!target && focused instanceof HTMLButtonElement
      && controlRef.current?.contains(focused) && focused.dataset.layoutTypeOption === type) {
      restoreFocus.current = focused;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onSwitch(type, saveDraft);
      setTarget(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "切换失败，原布局和草稿已保留，请重试。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function requestSwitch(type: RuntimeLayoutType) {
    if (type === activeType || disabled || busy) return;
    setError("");
    if (dirty) setTarget(type);
    else void commit(type, false);
  }
  const title = activeType === "renpy" ? advancedEnabled ? "Ren’Py · 进阶代码编辑" : "Ren’Py · 图形化布局编辑" : "AgentVN 客户端布局";
  return <>
    <div className="runtime-layout-type-control" ref={controlRef}
      data-testid="runtime-layout-type-control" aria-busy={busy}>
      <div className="runtime-layout-type-switch" role="group" aria-label="布局类型"
        aria-describedby="runtime-layout-type-description">
        <button type="button" aria-pressed={activeType === "agentvn"} data-layout-type-option="agentvn"
          disabled={disabled || busy} onClick={() => requestSwitch("agentvn")}>AgentVN</button>
        <button type="button" aria-pressed={activeType === "renpy"} data-layout-type-option="renpy"
          disabled={disabled || busy} onClick={() => requestSwitch("renpy")}>Ren’Py</button>
      </div>
      <label className="runtime-layout-advanced-toggle">
          <input type="checkbox" aria-label="Ren’Py进阶代码编辑" checked={advancedEnabled}
            disabled={activeType !== "renpy" || disabled || busy}
            onChange={event => onAdvancedChange?.(event.currentTarget.checked)} />
          <span>进阶</span>
      </label>
      <span id="runtime-layout-type-description" className="runtime-layout-type-description"
        aria-live="polite">{busy ? "正在保存并切换…" : title}</span>
      {error && !target && <span className="runtime-layout-save-feedback is-error" role="alert">{error}</span>}
    </div>
    <OperationResultDialog open={Boolean(target)} tone={error ? "error" : "warning"}
      label="布局类型" title="切换布局类型？"
      message={error || "当前布局有未保存的修改。两种类型独立保存，切换不会覆盖另一套布局。"}
      icon={<Layers size={20} />} confirmLabel="取消" closeAriaLabel="取消切换布局"
      busy={busy} suppressHoverHelp
      contextAction={{ label: "保存并切换", disabled: !canSave,
        onClick: () => target ? commit(target, true) : undefined }}
      secondaryAction={{ label: "放弃并切换",
        onClick: () => target ? commit(target, false) : undefined }}
      onDismiss={() => { setTarget(undefined); setError(""); }} />
  </>;
}
