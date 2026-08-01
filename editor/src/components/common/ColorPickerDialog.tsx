import { type CSSProperties, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Check, RotateCcw, X } from "lucide-react";
import { HexColorInput, HexColorPicker } from "react-colorful";

interface ColorPickerDialogProps {
  open: boolean;
  value?: string | null;
  title?: string;
  onApply: (value: string | null) => void;
  onClose: () => void;
}

const swatches = ["#d58a72", "#7f9fd4", "#6cbf9c", "#c58fd6", "#f2b35d", "#f6f0e8", "#272a36", "#f0566f"];

function normalizeHex(value?: string | null): string {
  const raw = String(value ?? "").trim();
  const prefixed = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-f]{6}$/i.test(prefixed) ? prefixed.toLowerCase() : "#d58a72";
}

function getContrastColor(hex: string): string {
  const value = normalizeHex(hex).slice(1);
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.62 ? "#17202e" : "#ffffff";
}

export function ColorPickerDialog({ open, value, title = "选择主题色", onApply, onClose }: ColorPickerDialogProps) {
  const titleId = useId();
  const [draft, setDraft] = useState(() => normalizeHex(value));

  useEffect(() => {
    if (open) setDraft(normalizeHex(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div className="color-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="color-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong id={titleId}>{title}</strong>
            <span>用于对白框边缘、说话人姓名和交互强调色。</span>
          </div>
          <button type="button" aria-label="关闭调色盘" data-help-key="colorPicker.close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="color-picker-body">
          <HexColorPicker color={draft} onChange={setDraft} />
          <div className="color-picker-side">
            <label>
              HEX
              <HexColorInput
                color={draft}
                prefixed
                data-help-key="colorPicker.input"
                onChange={(next) => setDraft(normalizeHex(next))}
              />
            </label>
            <div className="color-current-preview" aria-label={`当前颜色 ${draft}`} title={draft}>
              <span
                className="color-current-preview-chip"
                style={{ "--swatch-color": draft } as CSSProperties}
                aria-hidden="true"
              />
              <span>{draft}</span>
            </div>
            <div className="color-swatch-grid" role="group" aria-label="常用色板">
              {swatches.map((swatch) => (
                <button
                  type="button"
                  key={swatch}
                  className={draft === swatch ? "is-active" : ""}
                  style={
                    {
                      "--swatch-color": swatch,
                      "--swatch-check-color": getContrastColor(swatch),
                    } as CSSProperties
                  }
                  aria-label={`选择 ${swatch}`}
                  aria-pressed={draft === swatch}
                  title={`选择 ${swatch}`}
                  data-help-key="colorPicker.swatch"
                  onClick={() => setDraft(swatch)}
                >
                  {draft === swatch ? <Check className="color-swatch-check" size={18} strokeWidth={3} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
        <footer>
          <button type="button" data-help-key="colorPicker.clear" onClick={() => onApply(null)}>
            <RotateCcw size={15} />
            清除
          </button>
          <button type="button" data-help-key="colorPicker.cancel" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ai-glow-button" data-help-key="colorPicker.apply" onClick={() => onApply(draft)}>
            <Check size={15} />
            应用
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
