import type { UILayoutComponent, UILayoutComponentStyle, UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { NumberInput } from "../common/NumberInput";
import { GalleryPresentationSettings } from "./GalleryPresentationSettings";

export function GalleryGridSettings({ component, onChange, draft, onLayoutChange }: {
  component: UILayoutComponent;
  onChange: (patch: Partial<UILayoutComponentStyle>) => void;
  draft?: UISkinLayout;
  onLayoutChange?: (next: UISkinLayout) => void;
}) {
  if (component.component_type !== "gallery_grid") return null;
  return <section className="renpy-property" aria-label="画廊排列">
    <h4>画廊排列</h4>
    <div className="renpy-region-fields">
      {([["columns", "每行条目", 4, 8], ["rows", "每页行数", 2, 8], ["gap", "条目间距", 14, 64]] as const)
        .map(([key, label, fallback, max]) => <label key={key}>{label}
          <NumberInput type="number" aria-label={label} min={key === "gap" ? 0 : 1} max={max} step={1}
            disabled={component.locked} value={component.style?.[key] ?? fallback}
            onChange={event => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value)) onChange({ [key]: Math.max(key === "gap" ? 0 : 1, Math.min(max, Math.round(value))) });
            }} />
          <button type="button" disabled={component.locked || component.style?.[key] === undefined}
            aria-label={`${label}恢复继承`} onClick={() => onChange({ [key]: undefined })}>恢复继承</button>
        </label>)}
    </div>
    {draft && onLayoutChange && <GalleryPresentationSettings draft={draft} disabled={component.locked} onChange={onLayoutChange} />}
  </section>;
}
