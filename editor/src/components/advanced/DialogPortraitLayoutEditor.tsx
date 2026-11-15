import { NumberInput } from "../common/NumberInput";
import type { UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import {
  DIALOG_PORTRAIT_FIELDS, dialogPortraitStagePlacement, updateDialogPortraitLayout,
} from "../../../../shared/cartridge/dialogPortraitLayout";
import { RangeControl } from "../common/RangeControl";
import { RichSelect } from "../common/RichSelect";

/** Uses the designer's existing draft/undo/save pipeline, not a second store. */
export function DialogPortraitLayoutEditor({ draft, onChange }: {
  draft: UISkinLayout;
  onChange: (next: UISkinLayout) => void;
}) {
  const config = draft.dialogPortrait ?? {};
  const stagePlacement = dialogPortraitStagePlacement(config);
  const edit = (key: keyof typeof DIALOG_PORTRAIT_FIELDS, value: number | undefined) => {
    // Numeric edits retain the mode the user was editing, including an offset
    // entered before width/height. Do not reinterpret it as legacy geometry.
    const next = { ...config, placement: stagePlacement ? "stage-left" as const : "nameplate" as const };
    if (value === undefined) delete next[key];
    else next[key] = Math.min(DIALOG_PORTRAIT_FIELDS[key].max, Math.max(DIALOG_PORTRAIT_FIELDS[key].min, value));
    onChange(updateDialogPortraitLayout(draft, next));
  };
  return <details className="runtime-layout-fieldset" data-testid="dialog-portrait-layout-editor">
    <summary>对白头像布局</summary>
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
    <label>摆放方式<RichSelect ariaLabel="头像摆放方式"
      value={stagePlacement ? "stage-left" : "nameplate"}
      options={[{ value: "stage-left", label: "对白左下 · 独立大头像" }, { value: "nameplate", label: "姓名容器左侧" }]}
      onChange={placement => onChange(updateDialogPortraitLayout(draft, { ...config, placement }))} /></label>
    <label>切入效果<RichSelect ariaLabel="头像切入效果" value={config.entrance ?? "slide-left"}
      options={[{ value: "slide-left", label: "从左向右" }, { value: "none", label: "不切入" }]}
      onChange={entrance => onChange(updateDialogPortraitLayout(draft, { ...config, entrance }))} /></label>
    <label>图片适配<RichSelect ariaLabel="头像图片适配" value={config.fit ?? "contain"}
      options={[{ value: "contain", label: "完整显示" }, { value: "cover", label: "铺满裁切 · 顶部对齐" }]}
      onChange={fit => onChange(updateDialogPortraitLayout(draft, { ...config, fit }))} /></label>
    <p className="runtime-layout-field-note">在对白事件绑定头像。尺寸随画面缩放，左下大头像会为姓名与正文留出空间。</p>
    {([
      ["offsetX", "头像水平偏移", 0], ["offsetY", "头像垂直偏移", 0], ["size", "头像尺寸", 64],
      ["width", "大头像宽度", 208], ["height", "大头像高度", 240],
    ] as const).filter(([key]) => stagePlacement ? key !== "size" : key !== "width" && key !== "height")
      .map(([key, label, fallback]) => <label key={key}>
      <span>{label} <small>{config[key] === undefined ? "默认" : "当前布局覆盖"}</small></span>
      <div className="runtime-layout-input-pair">
        <RangeControl ariaLabel={`${label}滑块`} value={config[key] ?? fallback}
          min={DIALOG_PORTRAIT_FIELDS[key].min} max={DIALOG_PORTRAIT_FIELDS[key].max} step={1}
          onChange={value => edit(key, value)} />
        <NumberInput emptyValue="" type="number" aria-label={label} value={config[key] ?? ""}
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
