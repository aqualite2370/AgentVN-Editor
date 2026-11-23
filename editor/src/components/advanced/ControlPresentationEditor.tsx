import { compileControlPresentation, DEFAULT_CONTROL_PRESENTATION, type ControlPresentationSource } from "../../../../shared/cartridge/controlPresentation";
import type { UILayoutComponent } from "../../../../shared/cartridge/uiSkin";
import { RenpySettingHelp } from "./RenpySettingHelp";

export function ControlPresentationEditor({ component, onChange }: {
  component: UILayoutComponent;
  onChange: (source?: ControlPresentationSource) => void;
}) {
  const source = component.presentation ?? DEFAULT_CONTROL_PRESENTATION;
  const result = component.presentation ? compileControlPresentation(source) : undefined;
  const overridden = Object.keys(result?.definition?.styles[".root"] ?? {});
  return <section className="renpy-control-code" aria-label="当前控件进阶代码" data-testid="control-presentation-editor"
    data-presentation-for={component.component_id}>
    <header><h4 tabIndex={-1}>当前控件 · HTML / CSS</h4><span>{component.presentation ? "代码覆盖" : "沿用图形设置"}</span></header>
    <RenpySettingHelp key={component.component_id} label="HTML/CSS帮助">
      <p>HTML 保留一个 content 插槽以呈现原内容和操作；.root 样式覆盖图形设置，其余属性继续继承。</p>
      <p>标签：div、span、p、img、content。选择器：.root、.body、.title、.group、.icon、.label、.button，
        支持 hover、focus-visible、disabled。不支持脚本、外部网址或其他选择器。</p>
    </RenpySettingHelp>
    {!component.presentation
      ? <button type="button" disabled={component.locked} onClick={() => onChange(structuredClone(DEFAULT_CONTROL_PRESENTATION))}>
        为当前控件启用代码覆盖
      </button>
      : <>
        <label>HTML 结构
          <textarea aria-label="当前控件 HTML" spellCheck={false} value={source.html} disabled={component.locked}
            onChange={event => onChange({ ...source, html: event.currentTarget.value })} />
        </label>
        <label>CSS 样式
          <textarea aria-label="当前控件 CSS" spellCheck={false} value={source.css} disabled={component.locked}
            onChange={event => onChange({ ...source, css: event.currentTarget.value })} />
        </label>
        {result?.ok
          ? <output role="status">代码有效{overridden.length ? ` · 覆盖 ${overridden.join("、")}` : ""}</output>
          : <div role="alert"><strong>代码未应用，预览保留最近有效效果；修正前不能保存布局。</strong>
            <ul>{result?.issues.map((message, index) => <li key={`${index}:${message}`}>{message}</li>)}</ul></div>}
        <button type="button" disabled={component.locked} onClick={() => onChange(undefined)}>移除当前控件代码覆盖</button>
      </>}
  </section>;
}
