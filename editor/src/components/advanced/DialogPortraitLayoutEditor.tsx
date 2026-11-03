import type { UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import {
  DIALOG_PORTRAIT_FIELDS, updateDialogPortraitLayout, type DialogPortraitLayout,
} from "../../../../shared/cartridge/dialogPortraitLayout";
import { RangeControl } from "../common/RangeControl";

/** Uses the designer's existing draft/undo/save pipeline, not a second store. */
export function DialogPortraitLayoutEditor({ draft, onChange }: {
  draft: UISkinLayout;
  onChange: (next: UISkinLayout) => void;
}) {
  const config = draft.dialogPortrait ?? {};
  const edit = (key: keyof DialogPortraitLayout, value: number | undefined) => {
    const next = { ...config };
    if (value === undefined) delete next[key];
    else next[key] = Math.min(DIALOG_PORTRAIT_FIELDS[key].max, Math.max(DIALOG_PORTRAIT_FIELDS[key].min, value));
    onChange(updateDialogPortraitLayout(draft, next));
  };
  return <details className="runtime-layout-fieldset" data-testid="dialog-portrait-layout-editor">
    <summary>对白头像布局</summary>
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
    <p className="runtime-layout-field-note">默认位于姓名容器左侧，跟随姓名容器移动。偏移与尺寸使用参考像素，
      随游戏界面等比缩放；超出画面时约束在安全区。不改变姓名容器或正文区域。
      请在对白事件中绑定头像，再打开“实际 Runtime 预览”查看。</p>
    {([
      ["offsetX", "头像水平偏移", 0], ["offsetY", "头像垂直偏移", 0], ["size", "头像尺寸", 64],
    ] as const).map(([key, label, fallback]) => <label key={key}>
      <span>{label} <small>{config[key] === undefined ? key === "size" ? "自动适配姓名容器" : "默认" : "当前布局覆盖"}</small></span>
      <div className="runtime-layout-input-pair">
        <RangeControl ariaLabel={`${label}滑块`} value={config[key] ?? fallback}
          min={DIALOG_PORTRAIT_FIELDS[key].min} max={DIALOG_PORTRAIT_FIELDS[key].max} step={1}
          onChange={value => edit(key, value)} />
        <input type="number" aria-label={label} value={config[key] ?? ""}
          placeholder={key === "size" ? "自动" : "0"} step={1}
          min={DIALOG_PORTRAIT_FIELDS[key].min} max={DIALOG_PORTRAIT_FIELDS[key].max}
          onChange={event => {
            const value = event.currentTarget.valueAsNumber;
            if (event.currentTarget.value === "") edit(key, undefined);
            else if (Number.isFinite(value)) edit(key, value);
          }} />
      </div>
    </label>)}
    <button type="button" disabled={!Object.keys(config).length}
      onClick={() => onChange(updateDialogPortraitLayout(draft, undefined))}>恢复头像默认位置</button>
    <small>恢复默认会同时移除本类型的偏移和尺寸覆盖；另一布局类型保持不变。</small>
    </div>
  </details>;
}
