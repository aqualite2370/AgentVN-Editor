import { useState } from "react";
import type { UILayoutComponentStyle, UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import {
  CONFIRMATION_AUTHOR_RECT, constrainConfirmationRect, updateConfirmationLayout,
  type ConfirmationLayout,
} from "../../../../shared/cartridge/confirmationLayout";
import type { AssetRef } from "../../types/assets";
import { RenpyRuntimePreview } from "./RenpyRuntimePreview";
import { RenpyButtonRoleEditor } from "./RenpyButtonRoleEditor";
import { RichSelect } from "../common/RichSelect";
import "./confirmation-layout-editor.css";
import { ControlPresentationEditor } from "./ControlPresentationEditor";
import { RenpyControlAppearanceEditor } from "./RenpyControlAppearanceEditor";
import type { ControlPresentationSource } from "../../../../shared/cartridge/controlPresentation";

type Region = "panelStyle" | "titleStyle" | "textStyle";

export function ConfirmationLayoutEditor({ draft, previewDraft = draft, assets, mobile, onChange, onAssets, onPages }: {
  draft: UISkinLayout; assets: AssetRef[]; mobile: boolean;
  previewDraft?: UISkinLayout; onAssets?: (assets: AssetRef[]) => void;
  onChange: (layout: UISkinLayout) => void; onPages: () => void;
}) {
  const [region, setRegion] = useState<Region>("panelStyle");
  const [resetPending, setResetPending] = useState(false);
  const config = draft.confirmationLayout ?? {};
  const rect = config.rect ?? CONFIRMATION_AUTHOR_RECT;
  const style = config[region] ?? {};
  const presentationKey = ({ panelStyle: "panelPresentation", titleStyle: "titlePresentation", textStyle: "textPresentation" } as const)[region];
  const control = { component_id: `confirmation_${region}`, component_type: "about_panel" as const,
    style, presentation: config[presentationKey] };
  const setPresentation = (source?: ControlPresentationSource) => {
    const next = { ...config };
    if (source) next[presentationKey] = source; else delete next[presentationKey];
    update(next);
  };
  const patchStyle = (patch: Partial<UILayoutComponentStyle>) => {
    const nextStyle = Object.fromEntries(Object.entries({ ...style, ...patch }).filter(([, value]) => value !== undefined));
    update({ ...config, [region]: nextStyle });
  };
  const update = (value: ConfirmationLayout) => onChange(updateConfirmationLayout(draft, value));
  const setStyle = (key: keyof UILayoutComponentStyle, value: string | number | undefined) => {
    const nextStyle = { ...style, [key]: value };
    if (value === undefined) delete nextStyle[key];
    const next = { ...config };
    if (Object.keys(nextStyle).length) next[region] = nextStyle;
    else delete next[region];
    update(next);
  };
  return <div className="runtime-layout-grid confirmation-layout-editor" data-testid="confirmation-layout-editor">
    <aside className="runtime-layout-sidebar renpy-editor-fields">
      <h4>确认提示</h4>
      <button type="button" onClick={onPages}>页面导航</button>
      <p>共用确认框的外观；退出保存、快读确认及其他操作仍由游戏处理。</p>
      <RichSelect ariaLabel="确认提示区域" value={region} onChange={value => setRegion(value as Region)}
        options={[{ value: "panelStyle", label: "面板外框" },
          { value: "titleStyle", label: "标题" }, { value: "textStyle", label: "正文" }]} />
      <button type="button" onClick={() => setResetPending(true)}>恢复确认提示默认</button>
      {resetPending && <div role="group" aria-label="确认恢复确认提示布局">
        <p>仅清除此布局类型的确认面板与确认按钮覆盖；保留其他页面、共享样式和另一类型。</p>
        <button type="button" onClick={() => setResetPending(false)}>取消</button>
        <button type="button" onClick={() => {
          const next = updateConfirmationLayout(draft);
          if (next.renpy) delete next.renpy.confirmation;
          onChange(next); setResetPending(false);
        }}>确认恢复</button>
      </div>}
    </aside>
    <div className="runtime-layout-center">
      <RenpyRuntimePreview draft={previewDraft} page="title" mobile={mobile} assetManifest={assets}
        confirmationPreview fitToStage onSelectControl={id => {
          const selected = (["panelStyle", "titleStyle", "textStyle"] as const).find(key => id === `confirmation_${key}`);
          if (selected) setRegion(selected);
        }} />
      <p>真实 Runtime 确认框 · 预览操作不会关闭编辑器或修改剧情。</p>
    </div>
    <aside className="runtime-layout-inspector renpy-editor-fields">
      <h4>{region === "panelStyle" ? "面板外框" : region === "titleStyle" ? "标题" : "正文"}</h4>
      <output data-testid="confirmation-layout-source">{Object.keys(style).length ? "局部覆盖" : "继承主题"}</output>
      {draft.layout_type === "renpy" && <RenpyControlAppearanceEditor key={region} component={control}
        assets={assets} advancedEnabled={draft.advancedPresentationEnabled} onStyle={patchStyle}
        onImport={(asset, patch) => { onAssets?.([asset, ...assets]); patchStyle(patch); }} />}
      {draft.layout_type === "renpy" && draft.advancedPresentationEnabled && <ControlPresentationEditor
        component={control} onChange={setPresentation} />}
      {region === "panelStyle" && <section aria-label="确认提示几何">
        <p>位置和尺寸为画面百分比；正文超出时在面板内滚动，不裁掉操作入口。</p>
        {(["x", "y", "width", "height"] as const).map(key => <label key={key}>区域 {key}
          <input type="number" aria-label={`确认区域${key}`} value={rect[key]}
            onChange={event => {
              if (event.currentTarget.value !== "" && Number.isFinite(event.currentTarget.valueAsNumber))
                update({ ...config, rect: constrainConfirmationRect({ ...rect, [key]: event.currentTarget.valueAsNumber }) });
            }} />
        </label>)}
        {config.rect && <button type="button" onClick={() => {
          const next = { ...config }; delete next.rect; update(next);
        }}>恢复默认位置与尺寸</button>}
      </section>}
      {draft.layout_type !== "renpy" && (region === "panelStyle" ? [
        ["backgroundColor", "背景色", "#18202c"], ["borderColor", "边框色", "#ffffff"],
      ] : [["color", "文字色", "#ffffff"]]).map(([key, label, fallback]) =>
        <label key={key}>{label}
          <input aria-label={`确认${label}`} value={String(style[key as keyof UILayoutComponentStyle] ?? fallback)}
            onChange={event => setStyle(key as keyof UILayoutComponentStyle, event.currentTarget.value)} />
          {style[key as keyof UILayoutComponentStyle] !== undefined && <button type="button"
            aria-label={`恢复确认${label}继承`} onClick={() => setStyle(key as keyof UILayoutComponentStyle, undefined)}>恢复继承</button>}
        </label>)}
      {draft.layout_type !== "renpy" && (region === "panelStyle" ? [
        ["borderWidth", "边框宽度", 1, 0, 24], ["borderRadius", "圆角", 8, 0, 64],
        ["padding", "内边距", 18, 0, 96], ["gap", "间距", 16, 0, 60],
      ] : [["fontSize", "字号", 20, 8, 96], ["fontWeight", "字重", 500, 100, 900]])
        .map(([key, label, fallback, min, max]) => <label key={key}> {label}
          <input aria-label={`确认${label}`} type="number" min={min} max={max}
            value={Number(style[key as keyof UILayoutComponentStyle] ?? fallback)}
            onChange={event => {
              if (event.currentTarget.value !== "" && Number.isFinite(event.currentTarget.valueAsNumber))
                setStyle(key as keyof UILayoutComponentStyle,
                  Math.max(Number(min), Math.min(Number(max), event.currentTarget.valueAsNumber)));
            }} />
          {style[key as keyof UILayoutComponentStyle] !== undefined && <button type="button"
            aria-label={`恢复确认${label}继承`} onClick={() => setStyle(key as keyof UILayoutComponentStyle, undefined)}>恢复继承</button>}
        </label>)}
      {draft.layout_type === "renpy" && <RenpyButtonRoleEditor draft={draft} page="confirmation"
        roles={["modal_action"]} onChange={onChange} />}
    </aside>
  </div>;
}
