import { useEffect, useRef, useState } from "react";
import type { UILayoutComponent, UILayoutComponentStyle } from "../../../../shared/cartridge/uiSkin";
import type { AssetRef } from "../../types/assets";
import { createImportedUIImageAsset, readFileAsDataUrl, validateImportedUIImageFile } from "../../utils/projectAssets";
import { assetIdFromUILayoutReference, resolveUILayoutImagePreview, toUILayoutAssetReference } from "../../utils/uiLayoutAssetReference";
import { RichSelect } from "../common/RichSelect";
import { controlPresentationOverrides } from "../../../../shared/cartridge/controlPresentation";
import { RenpySettingHelp } from "./RenpySettingHelp";

/** The ordinary editor changes one authored component, never a shared button role. */
export function RenpyControlAppearanceEditor({ component, assets, advancedEnabled = false, onStyle, onStateStyle, onImport }: {
  component: UILayoutComponent;
  assets: AssetRef[];
  advancedEnabled?: boolean;
  onStyle: (patch: Partial<UILayoutComponentStyle>) => void;
  onStateStyle?: (state: "hover" | "selected" | "disabled", patch: Partial<UILayoutComponentStyle>) => void;
  onImport: (asset: AssetRef, patch: Partial<UILayoutComponentStyle>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"normal" | "hover" | "selected" | "disabled">("normal");
  const style = { ...component.style, ...component.stateStyles?.normal,
    ...(state === "normal" ? {} : component.stateStyles?.[state]) };
  const code = controlPresentationOverrides(component.presentation, advancedEnabled, state);
  const change = (patch: Partial<UILayoutComponentStyle>) => state === "normal" ? onStyle(patch) : onStateStyle?.(state, patch);
  const current = resolveUILayoutImagePreview(style?.backgroundImage, assets);
  const alive = useRef(true), importCallback = useRef(onImport);
  importCallback.current = onImport;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const imageAssets = assets.filter(asset => ["background", "sprite", "portrait", "ui"].includes(asset.asset_type)
    || asset.asset_type === "other" && asset.metadata.mime_type?.startsWith("image/"));
  async function importImage(file?: File) {
    if (!file || busy) return;
    const validation = validateImportedUIImageFile(file);
    if (!validation.ok) { setError(validation.message); return; }
    setBusy(true); setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const asset = createImportedUIImageAsset(file, dataUrl, new Set(assets.map(item => item.asset_id)));
      if (!alive.current) return;
      importCallback.current(asset, { backgroundImage: toUILayoutAssetReference(asset.asset_id),
        backgroundFit: component.style?.backgroundFit ?? "cover" });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "图片读取失败，原设置已保留。");
    } finally { if (alive.current) setBusy(false); }
  }
  return <section className="renpy-control-appearance" aria-label="当前控件背景" data-testid="renpy-control-appearance">
    <h4>当前控件 · 外观</h4>
    <RenpySettingHelp label="当前控件外观帮助" testId="renpy-appearance-help">
      <p>设置作用于当前控件。清除图片或恢复继承后使用页面、共享样式或主题的值。</p>
      <p>按钮可分别设置普通、悬停、选中和禁用外观；批量修改请展开“按钮角色与状态”。</p>
    </RenpySettingHelp>
    {onStateStyle && <label>编辑状态
      <RichSelect ariaLabel="当前控件状态" value={state} disabled={busy}
        options={[{ value: "normal", label: "普通" }, { value: "hover", label: "悬停 / 焦点" },
          { value: "selected", label: "选中" }, { value: "disabled", label: "禁用" }]}
        onChange={setState} />
    </label>}
    <RichSelect ariaLabel="当前控件背景图" disabled={component.locked || busy}
      value={assetIdFromUILayoutReference(style?.backgroundImage) ?? ""}
      options={[{ value: "", label: "不单独设置图片" }, ...imageAssets.map(asset => ({
        value: asset.asset_id, label: asset.metadata.display_name || asset.metadata.filename || asset.asset_id,
      }))]}
      onChange={id => change({ backgroundImage: id ? toUILayoutAssetReference(id) : undefined })} />
    {current.source && <img className="renpy-control-background-preview" src={current.source} alt="当前控件背景预览" />}
    {current.missing && <p role="alert">引用的图片已不在素材库，请重新选择。</p>}
    <div className="row-actions">
      <button type="button" disabled={component.locked || busy || state !== "normal"} onClick={() => fileRef.current?.click()}>
        {busy ? "正在导入…" : "导入图片"}
      </button>
      <button type="button" aria-label="清除当前控件背景图"
        disabled={component.locked || busy || !style?.backgroundImage}
        onClick={() => change({ backgroundImage: undefined })}>清除图片</button>
    </div>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
      hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importImage(file); }} />
    <label className="renpy-context-field">图片如何显示
      <RichSelect ariaLabel="背景图适配" value={style?.backgroundFit ?? "cover"}
        disabled={component.locked || busy}
        options={[{ value: "cover", label: "铺满并裁切" }, { value: "contain", label: "完整显示" },
          { value: "stretch", label: "拉伸铺满" }]}
        onChange={backgroundFit => change({ backgroundFit })} />
      <span className="renpy-field-hint" data-testid="renpy-background-fit-help">
        铺满会裁切边缘；完整显示保留全图；拉伸铺满可能改变比例。
      </span>
    </label>
    <output data-testid="renpy-background-source">{state === "normal"
      ? component.style?.backgroundImage ? "当前控件覆盖" : "页面 / 主题继承"
      : component.stateStyles?.[state]?.backgroundImage ? "当前状态覆盖" : "继承普通状态"}</output>
    <div className="renpy-region-fields">
      {([["backgroundColor", "背景颜色"], ["color", "文字颜色"], ["borderColor", "边框颜色"]] as const).map(([key, label]) =>
        <label key={key}>{label}<input type="color" aria-label={`当前控件${label}`} disabled={component.locked || code[key] !== undefined}
          value={/^#[0-9a-f]{6}$/i.test(code[key] ?? style?.[key] ?? "") ? (code[key] ?? style[key])! : key === "color" ? "#ffffff" : "#1c1c1c"}
          onChange={event => change({ [key]: event.currentTarget.value })} />
          {code[key] !== undefined && <small data-code-property={key}>代码覆盖：{code[key]}（在下方代码区修改）</small>}
          <button type="button" disabled={component.locked || code[key] !== undefined || (state === "normal" ? !component.style?.[key] : !component.stateStyles?.[state]?.[key])}
            onClick={() => change({ [key]: undefined })}>恢复继承</button>
        </label>)}
    </div>
    <div className="renpy-region-fields">
      {([["fontSize", "文字大小", 8, 96], ["padding", "内容留白", 0, 96], ["gap", "元素间距", 0, 96],
        ["borderWidth", "边框粗细", 0, 24], ["borderRadius", "圆角大小", 0, 64]] as const).map(([key, label, min, max]) => {
        const codeValue = code[key];
        const numeric = codeValue && /^\d+(?:\.\d+)?(?:px)?$/.test(codeValue) ? parseFloat(codeValue) : undefined;
        return <label key={key}>{label}
          <input type="number" aria-label={`当前控件${label}`} min={min} max={max} step={1}
            placeholder="继承" value={numeric ?? style[key] ?? ""} disabled={component.locked || Boolean(codeValue) || state !== "normal"}
            onChange={event => {
              const value = event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber;
              if (value === undefined || Number.isFinite(value) && value >= min && value <= max) change({ [key]: value });
            }} />
          <small className={codeValue ? undefined : "renpy-field-hint"} data-code-property={codeValue ? key : undefined}>{codeValue ? `代码覆盖：${codeValue}（在下方修改）`
            : state !== "normal" ? "尺寸沿用普通状态，避免按钮跳动"
            : style[key] !== undefined ? "恢复继承可移除此项覆盖。" : "留空使用页面或共享样式。"}</small>
          <button type="button" disabled={component.locked || Boolean(codeValue) || state !== "normal" || style[key] === undefined}
            onClick={() => change({ [key]: undefined })}>恢复继承</button>
        </label>;
      })}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
