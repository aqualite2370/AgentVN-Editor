import type { UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { RENPY_TITLE_TEXT_MAX_LENGTH, type RenpyTitleTextItem } from "../../../../shared/cartridge/renpyTitleControls";
import { RenpySettingHelp } from "./RenpySettingHelp";

/** Wording is independent of the hero's artwork, opacity and project identity. */
export function RenpyTitleTextEditor({ draft, disabled, onChange }: {
  draft: UISkinLayout;
  disabled?: boolean;
  onChange: (layout: UISkinLayout) => void;
}) {
  const update = (key: "title" | "version", patch: Partial<RenpyTitleTextItem>) => {
    if (disabled) return;
    const next = structuredClone(draft), item = { ...next.renpyTitleText?.[key], ...patch };
    if (item.text === undefined) delete item.text;
    if (item.visible === undefined) delete item.visible;
    next.renpyTitleText = { ...next.renpyTitleText };
    if (Object.keys(item).length) next.renpyTitleText[key] = item;
    else delete next.renpyTitleText[key];
    if (!Object.keys(next.renpyTitleText).length) delete next.renpyTitleText;
    onChange(next);
  };
  return <section className="renpy-title-text-editor renpy-property" aria-label="主页文字">
    <h4>主页文字</h4>
    <RenpySettingHelp label="主页文字帮助">
      <p>标题和版本独立显隐。自定义文字留空时不显示；隐藏后保留文字，恢复继承使用工程信息。</p>
    </RenpySettingHelp>
    {(["title", "version"] as const).map(key => {
      const name = key === "title" ? "标题" : "版本", item = draft.renpyTitleText?.[key];
      return <fieldset key={key} disabled={disabled}>
        <legend>{name}</legend>
        <label className="renpy-title-text-visible">
          <input type="checkbox" aria-label={`显示${name}`} checked={item?.visible !== false}
            onChange={event => update(key, { visible: event.currentTarget.checked ? undefined : false })} />
          显示{name}
        </label>
        <output data-testid={`renpy-${key}-text-source`}>
          {item?.text === undefined ? "继承工程信息" : "自定义文字"}
        </output>
        {item?.text === undefined
          ? <button type="button" onClick={() => update(key, { text: "" })}>{`自定义${name}文字`}</button>
          : <>
            <label>{name}文字
              <input type="text" aria-label={`${name}文字`} maxLength={RENPY_TITLE_TEXT_MAX_LENGTH}
                value={item.text} placeholder="留空则不显示文字"
                onChange={event => update(key, { text: event.currentTarget.value })} />
            </label>
            <small className="renpy-field-hint">留空不显示；隐藏后仍保留文字。</small>
            <button type="button" onClick={() => update(key, { text: undefined })}>{`恢复${name}工程继承`}</button>
          </>}
      </fieldset>;
    })}
  </section>;
}
