import type { UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { DEFAULT_GALLERY_PRESENTATION } from "../../../../shared/cartridge/galleryPresentation";
import { NumberInput } from "../common/NumberInput";
import { RichSelect } from "../common/RichSelect";

export function GalleryPresentationSettings({ draft, disabled, onChange }: {
  draft: UISkinLayout; disabled?: boolean; onChange: (next: UISkinLayout) => void;
}) {
  const config = draft.galleryPresentation ?? DEFAULT_GALLERY_PRESENTATION;
  return <section className="renpy-property" aria-label="画廊统一容器">
    <h4>画廊统一容器</h4>
    <RichSelect ariaLabel="画廊容器比例" disabled={disabled}
      value={`${config.width}:${config.height}`}
      options={[{ value: "1600:900", label: "16:9" }, { value: "1600:1000", label: "16:10" },
        { value: "1200:900", label: "4:3" }, { value: "1000:1000", label: "1:1" },
        ...(!["1600:900", "1600:1000", "1200:900", "1000:1000"].includes(`${config.width}:${config.height}`)
          ? [{ value: `${config.width}:${config.height}`, label: "自定义" }] : [])]}
      onChange={value => {
        const [width, height] = value.split(":").map(Number);
        onChange({ ...draft, galleryPresentation: { width, height } });
      }} />
    <div className="renpy-region-fields">{(["width", "height"] as const).map(key => <label key={key}>
      {key === "width" ? "参考宽度" : "参考高度"}
      <NumberInput type="number" aria-label={`画廊容器${key === "width" ? "宽度" : "高度"}`}
        min={64} max={8192} step={1} value={config[key]} disabled={disabled}
        onChange={event => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isInteger(value) && value >= 64 && value <= 8192)
            onChange({ ...draft, galleryPresentation: { ...config, [key]: value } });
        }} />
    </label>)}</div>
    <small>影响当前布局的全部画廊图片与大图。请保持素材比例一致；选择裁切的图片可能丢失边缘。</small>
    <button type="button" disabled={disabled || !draft.galleryPresentation} onClick={() => {
      const next = { ...draft }; delete next.galleryPresentation; onChange(next);
    }}>恢复默认比例</button>
  </section>;
}
