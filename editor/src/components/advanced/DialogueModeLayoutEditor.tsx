import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { UISkinLayout, UILayoutComponentStyle, UILayoutRect } from "../../../../shared/cartridge/uiSkin";
import {
  DIALOGUE_LAYOUT_MODES, resolveDialogueModeLayout, updateDialogueModeLayout, constrainDialogueLayoutRect,
  type DialogueModeLayout,
} from "../../../../shared/cartridge/dialogueModeLayout";
import { assetIdFromUILayoutReference, toUILayoutAssetReference } from "../../../../shared/cartridge/uiAssetReference";
import type { AssetRef } from "../../types/assets";
import { RichSelect } from "../common/RichSelect";
import { RangeControl } from "../common/RangeControl";
import { AssetPicker } from "../common/AssetPicker";
import { RenpyRuntimePreview } from "./RenpyRuntimePreview";
import "./dialogue-mode-layout-editor.css";
import { ControlPresentationEditor } from "./ControlPresentationEditor";
import { RenpyControlAppearanceEditor } from "./RenpyControlAppearanceEditor";
import type { ControlPresentationSource } from "../../../../shared/cartridge/controlPresentation";

type Mode = "nvl" | "bubble";
type Region = "panelStyle" | "textStyle" | "speakerStyle";

export function DialogueModeLayoutEditor({ draft, previewDraft = draft, mode, onMode, onChange, onAssets, onOrdinaryPage, mobile, assets }: {
  draft: UISkinLayout;
  previewDraft?: UISkinLayout;
  mode: Mode;
  onMode: (mode: "dialog" | Mode) => void;
  onChange: (next: UISkinLayout) => void;
  onOrdinaryPage: () => void;
  mobile: boolean;
  assets: AssetRef[];
  onAssets?: (assets: AssetRef[]) => void;
}) {
  const [region, setRegion] = useState<Region>("panelStyle");
  const [resetPending, setResetPending] = useState(false);
  const [movingRect, setMovingRect] = useState<UILayoutRect>();
  const drag = useRef<{ id: number; x: number; y: number; width: number; height: number;
    rect: UILayoutRect; moved: boolean } | undefined>(undefined);
  const label = mode === "nvl" ? "NVL" : "气泡";
  const resolved = resolveDialogueModeLayout(draft, mode);
  const config = draft.dialogueLayouts?.[mode] ?? {};
  const rect = movingRect ?? resolved.rect;
  const preview = movingRect
    ? updateDialogueModeLayout(previewDraft, mode, { ...previewDraft.dialogueLayouts?.[mode], rect: movingRect }) : previewDraft;
  const update = (patch: Partial<DialogueModeLayout>) =>
    onChange(updateDialogueModeLayout(draft, mode, { ...config, ...patch }));
  const style = resolved[region];
  const presentationKey = ({ panelStyle: "panelPresentation", textStyle: "textPresentation", speakerStyle: "speakerPresentation" } as const)[region];
  const control = { component_id: `${mode}_${region}`, component_type: "dialog_panel" as const,
    style: config[region], presentation: config[presentationKey] };
  const setPresentation = (source?: ControlPresentationSource) => {
    const next = { ...config };
    if (source) next[presentationKey] = source; else delete next[presentationKey];
    onChange(updateDialogueModeLayout(draft, mode, next));
  };
  const patchStyle = (patch: Partial<UILayoutComponentStyle>) => {
    const nextStyle = Object.fromEntries(Object.entries({ ...config[region], ...patch }).filter(([, value]) => value !== undefined));
    update({ [region]: nextStyle });
  };
  const setStyle = (key: keyof UILayoutComponentStyle, value: unknown) => {
    const next = { ...config[region], [key]: value };
    if (value === undefined) delete next[key];
    const nextConfig = { ...config };
    if (Object.keys(next).length) nextConfig[region] = next;
    else delete nextConfig[region];
    onChange(updateDialogueModeLayout(draft, mode, nextConfig));
  };
  const number = (key: keyof UILayoutComponentStyle, fieldLabel: string, fallback: number, min: number, max: number) => {
    const value = typeof style[key] === "number" ? style[key] as number : fallback;
    return <label className="dialogue-mode-field" key={key}>
      <span>{fieldLabel} <small>{config[region]?.[key] === undefined ? "继承" : "覆盖"}</small></span>
      <div className="dialogue-mode-number">
        <RangeControl value={value} min={min} max={max} step={key === "opacity" ? 0.05 : 1}
          ariaLabel={`${label}${fieldLabel}滑块`} onChange={value => setStyle(key, value)} />
        <input type="number" aria-label={`${label}${fieldLabel}`} value={value} min={min} max={max}
          step={key === "opacity" ? 0.05 : 1}
          onChange={event => {
            if (event.currentTarget.value !== "") setStyle(key, Math.max(min, Math.min(max, Number(event.currentTarget.value))));
          }} />
      </div>
      {config[region]?.[key] !== undefined && <button type="button" aria-label={`恢复继承${label}${fieldLabel}`}
        onClick={() => setStyle(key, undefined)}>恢复继承</button>}
    </label>;
  };
  const color = (key: "backgroundColor" | "color" | "borderColor", fieldLabel: string, fallback: string) =>
    <label className="dialogue-mode-field" key={key}>
      <span>{fieldLabel} <small>{config[region]?.[key] === undefined ? "继承" : "覆盖"}</small></span>
      <input aria-label={`${label}${fieldLabel}`} value={style[key] ?? fallback}
        onChange={event => setStyle(key, event.currentTarget.value)} />
      {config[region]?.[key] !== undefined && <button type="button" aria-label={`恢复继承${label}${fieldLabel}`}
        onClick={() => setStyle(key, undefined)}>恢复继承</button>}
    </label>;
  const dragStart = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || drag.current) return;
    const frame = event.currentTarget.closest(".renpy-editor-device-canvas")?.getBoundingClientRect();
    if (!frame?.width || !frame.height) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
      width: frame.width, height: frame.height, rect: resolved.rect, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x, dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) <= 6) return;
    state.moved = true;
    setMovingRect(constrainDialogueLayoutRect({ ...state.rect,
      x: state.rect.x + dx / state.width * 100,
      y: state.rect.y + dy / state.height * 100 }));
  };
  const dragEnd = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = undefined;
    if (!cancelled && state.moved && movingRect) update({ rect: movingRect });
    setMovingRect(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const overlay = <div className="dialogue-mode-drag-region" style={{
    left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%`,
    transform: rect.anchor === "center" ? "translate(-50%,-50%)" : undefined,
  } as CSSProperties}>
    <button type="button" aria-label={`拖动${label}区域`} className="dialogue-mode-drag-handle"
      onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={event => dragEnd(event)}
      onPointerCancel={event => dragEnd(event, true)} onLostPointerCapture={event => dragEnd(event, true)}
      onKeyDown={event => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          const id = drag.current.id;
          drag.current = undefined;
          setMovingRect(undefined);
          if (event.currentTarget.hasPointerCapture(id)) event.currentTarget.releasePointerCapture(id);
          return;
        }
        const delta = event.shiftKey ? 5 : 1;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        update({ rect: constrainDialogueLayoutRect({ ...rect,
          x: rect.x + (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0),
          y: rect.y + (event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0),
        }) });
      }}>移动 {label}</button>
  </div>;
  return <div className="runtime-layout-grid dialogue-mode-layout-editor"
    data-testid="dialogue-mode-layout-editor" data-dialogue-mode={mode}>
    <aside className="runtime-layout-sidebar">
      <strong>剧情布局</strong>
      <RichSelect ariaLabel="对白布局模式" value={mode} options={[...DIALOGUE_LAYOUT_MODES]}
        onChange={value => onMode(value as "dialog" | Mode)} />
      <button type="button" onClick={onOrdinaryPage}>返回页面导航</button>
      <strong>区域</strong>
      {([["panelStyle", "区域外框"], ["textStyle", "正文"], ["speakerStyle", "姓名"]] as const)
        .map(([key, name]) => <button type="button" key={key} aria-pressed={region === key}
          onClick={() => setRegion(key)}>{name}</button>)}
      <p>{mode === "nvl" ? "逐句累积、翻页和清页沿用剧情设置。" : "优先跟随角色或节点锚点；此处调整默认锚点及尺寸。"}
        外观修改不会改变剧情模式、角色配置或存档。</p>
      <button type="button" onClick={() => setResetPending(true)}>恢复当前模式默认</button>
      {resetPending && <div role="group" aria-label={`确认恢复${label}布局`}>
        <p>仅移除当前{label}布局覆盖，保留普通对白与另一模式。</p>
        <button type="button" onClick={() => setResetPending(false)}>取消</button>
        <button type="button" onClick={() => {
          onChange(updateDialogueModeLayout(draft, mode, undefined)); setResetPending(false);
        }}>确认恢复</button>
      </div>}
    </aside>
    <div className="runtime-layout-center">
      <RenpyRuntimePreview draft={preview} page="player" mobile={mobile} fitToStage
        assetManifest={assets} dialogueMode={mode} overlay={overlay} onSelectControl={id => {
          const selected = (["panelStyle", "textStyle", "speakerStyle"] as const).find(key => id === `${mode}_${key}`);
          if (selected) setRegion(selected);
        }} />
    </div>
    <aside className="runtime-layout-inspector dialogue-mode-fields">
      <strong>{label}布局属性</strong>
      <p data-testid="dialogue-mode-layout-source">{resolved.overridden ? "当前模式覆盖" : "继承普通对白共享外观 · 默认模式几何"}</p>
      {draft.layout_type === "renpy" && <RenpyControlAppearanceEditor key={`${mode}:${region}`} component={control}
        assets={assets} advancedEnabled={draft.advancedPresentationEnabled} onStyle={patchStyle}
        onImport={(asset, patch) => { onAssets?.([asset, ...assets]); patchStyle(patch); }} />}
      {draft.layout_type === "renpy" && draft.advancedPresentationEnabled && <ControlPresentationEditor
        component={control} onChange={setPresentation} />}
      {region === "panelStyle" && <details open={draft.layout_type !== "renpy"}><summary>位置与尺寸</summary>
        <p>{config.rect ? "自定义区域" : "继承模式默认"}；百分比按游戏实际渲染帧计算。</p>
        {(["x", "y", "width", "height"] as const).map(key => <label className="dialogue-mode-field" key={key}>
          <span>{({ x: "水平位置", y: "垂直位置", width: "宽度", height: "高度" })[key]}（%）</span>
          <div className="dialogue-mode-number">
            <RangeControl ariaLabel={`${label}区域${key}滑块`} value={rect[key]} min={key === "width" || key === "height" ? 1 : 0}
              max={100} onChange={value => update({ rect: constrainDialogueLayoutRect({ ...rect, [key]: value }) })} />
            <input type="number" aria-label={`${label}区域${key}`} value={rect[key]} min={key === "width" || key === "height" ? 1 : 0}
              max={100} step={1} onChange={event => {
                if (event.currentTarget.value !== "") update({ rect: constrainDialogueLayoutRect({ ...rect,
                  [key]: Number(event.currentTarget.value) }) });
              }} />
          </div>
        </label>)}
        {config.rect && <button type="button" onClick={() => {
          const next = { ...config }; delete next.rect;
          onChange(updateDialogueModeLayout(draft, mode, next));
        }}>恢复默认几何</button>}
      </details>}
      <details open={draft.layout_type !== "renpy"}><summary>{draft.layout_type === "renpy" ? "字体与更多外观" : "外观与继承"}</summary>
        {region === "panelStyle" ? <>
          {draft.layout_type !== "renpy" && <>
            {color("backgroundColor", "背景色", "#111111")}
            {color("borderColor", "边框色", "#ffffff")}
            {number("borderWidth", "边框宽度", 0, 0, 24)}
            {number("borderRadius", "圆角", mode === "bubble" ? 16 : 0, 0, 64)}
            {number("padding", "内边距", 14, 0, 96)}
          </>}
          {number("opacity", "不透明度", 0.78, 0, 1)}
          {draft.layout_type !== "renpy" && <AssetPicker label={`${label}背景图`} field={`dialogueLayouts.${mode}.panelStyle.backgroundImage`}
            value={assetIdFromUILayoutReference(config.panelStyle?.backgroundImage) ?? ""}
            allowedTypes={["background", "ui", "sprite"]} helpKey="layout.backgroundImage" variant="inline"
            onChange={id => setStyle("backgroundImage", toUILayoutAssetReference(id))}
            placeholder="继承共享背景图" />}
        </> : <>
          {draft.layout_type !== "renpy" && <>{color("color", "文字色", "#ffffff")}
          {number("fontSize", "字号", 24, 8, 96)}</>}
          {number("fontWeight", "字重", 500, 100, 900)}
          <RichSelect ariaLabel={`${label}字体`} value={config[region]?.fontAssetId ?? ""}
            options={[{ value: "", label: "继承共享字体" }, ...assets.filter(asset => asset.asset_type === "font")
              .map(asset => ({ value: asset.asset_id, label: asset.metadata.display_name ?? asset.metadata.filename ?? asset.asset_id }))]}
            onChange={id => setStyle("fontAssetId", id || undefined)} />
          <RichSelect ariaLabel={`${label}文本对齐`} value={style.textAlign ?? "left"}
            options={[{ value: "left", label: "左对齐" }, { value: "center", label: "居中" }, { value: "right", label: "右对齐" }]}
            onChange={value => setStyle("textAlign", value)} />
        </>}
      </details>
    </aside>
  </div>;
}
