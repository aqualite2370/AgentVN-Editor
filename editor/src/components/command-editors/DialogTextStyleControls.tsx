import type { DialogVisualStyle } from "../../../../shared/cartridge/types";
import { RichSelect } from "../common/RichSelect";

export type DialogTextStyleValue = Pick<DialogVisualStyle, "text_color" | "font_size" | "font_weight" | "font_style">;

const labelUnset = "\u672a\u8bbe\u7f6e";
const fontWeightOptions = [
  { value: "", label: labelUnset },
  { value: "300", label: "\u7ec6\u4f53 300" },
  { value: "400", label: "\u5e38\u89c4 400" },
  { value: "500", label: "\u4e2d\u7b49 500" },
  { value: "600", label: "\u534a\u7c97 600" },
  { value: "700", label: "\u7c97\u4f53 700" },
  { value: "800", label: "\u7279\u7c97 800" },
  { value: "900", label: "\u9ed1\u4f53 900" },
];

function clampFontSize(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(96, Math.max(10, Math.round(parsed)));
}

export function hasDialogTextStyle(style: DialogVisualStyle | null | undefined): boolean {
  return Boolean(style?.text_color || style?.font_size || style?.font_weight || style?.font_style);
}

export function pickDialogTextStyle(style: DialogVisualStyle | null | undefined): DialogTextStyleValue {
  return {
    text_color: style?.text_color ?? null,
    font_size: style?.font_size ?? null,
    font_weight: style?.font_weight ?? null,
    font_style: style?.font_style ?? null,
  };
}

export function DialogTextStyleControls({
  value,
  onChange,
  title = "\u6587\u5b57\u6837\u5f0f",
}: {
  value: DialogTextStyleValue;
  onChange: (next: DialogTextStyleValue) => void;
  title?: string;
}) {
  return (
    <div className="dialog-text-style-controls">
      <strong>{title}</strong>
      <label>
        {"\u5b57\u53f7"}
        <input
          type="number"
          min={10}
          max={96}
          step={1}
          value={value.font_size ?? ""}
          data-help-key="command.dialog.style.manual"
          placeholder="继承布局"
          onChange={(event) => onChange({ ...value, font_size: clampFontSize(event.target.value) })}
        />
      </label>
      <label>
        字重
        <RichSelect
          ariaLabel="对白文字字重"
          value={value.font_weight ? String(value.font_weight) : ""}
          options={fontWeightOptions}
          onChange={(next) => onChange({ ...value, font_weight: next ? Number(next) : null })}
        />
      </label>
      <label>
        样式
        <RichSelect
          ariaLabel="对白文字样式"
          value={value.font_style ?? ""}
          options={[
            { value: "", label: labelUnset },
            { value: "normal", label: "\u5e38\u89c4" },
            { value: "italic", label: "\u659c\u4f53" },
          ]}
          onChange={(next) => onChange({ ...value, font_style: next === "normal" || next === "italic" ? next : null })}
        />
      </label>
      <label>
        {"\u6587\u5b57\u989c\u8272"}
        <input
          type="color"
          data-help-key="command.dialog.style.color"
          value={value.text_color ?? "#ffffff"}
          onChange={(event) => onChange({ ...value, text_color: event.target.value.toLowerCase() })}
        />
      </label>
      <button type="button" data-help-key="command.dialog.style.restoreInherit" onClick={() => onChange({ text_color: null, font_size: null, font_weight: null, font_style: null })}>
        {"\u6e05\u9664\u6587\u5b57\u6837\u5f0f"}
      </button>
    </div>
  );
}
