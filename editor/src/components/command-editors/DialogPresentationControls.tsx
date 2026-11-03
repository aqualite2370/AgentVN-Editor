import type { BubblePositionConfig, DialogPresentationMode } from "../../../../shared/cartridge/types";
import { useProjectStore } from "../../store/projectStore";
import { FieldHelp } from "../common/FieldHelp";
import { RichSelect } from "../common/RichSelect";

const modes = [
  { value: "dialog", label: "普通对白框" },
  { value: "nvl", label: "NVL 累积阅读" },
  { value: "bubble", label: "气泡对白" },
];

export function DialogPresentationControls({ command, onChange }: {
  command: { type: "dialog" | "narration"; character_id?: string;
    presentation_mode?: DialogPresentationMode; clear_nvl_page_before?: boolean;
    bubble_position?: BubblePositionConfig };
  onChange: (patch: { presentation_mode?: DialogPresentationMode;
    clear_nvl_page_before?: boolean; bubble_position?: BubblePositionConfig }) => void;
}) {
  const projectMode = useProjectStore(state => state.settings.defaultDialogPresentation);
  const characterModes = useProjectStore(state => state.settings.characterDialogPresentations);
  const setCharacterMode = useProjectStore(state => state.setCharacterDialogPresentation);
  const characterId = command.type === "dialog" ? command.character_id?.trim() : undefined;
  const characterMode = characterId ? characterModes?.[characterId] : undefined;
  const effective = command.presentation_mode ?? characterMode ?? projectMode ?? "dialog";
  const source = command.presentation_mode ? "当前节点" : characterMode ? "角色默认" : "工程默认";
  const position = command.bubble_position;
  const fixed = position?.mode === "fixed";
  const field = (key: "x" | "y" | "offset_x" | "offset_y", label: string) => {
    const value = position?.mode === "fixed" ? key === "x" ? position.x : position.y
      : key === "x" ? 50 : key === "y" ? 20
        : key === "offset_x" ? position?.offset_x ?? 0 : position?.offset_y ?? 0;
    return <label key={key}>{label}
      <input type="number" aria-label={label} min={fixed ? 0 : -100} max={100} step={1} value={value}
        onChange={event => {
          const n = event.currentTarget.valueAsNumber;
          if (!Number.isFinite(n) || n < (fixed ? 0 : -100) || n > 100) return;
          const next: BubblePositionConfig = position?.mode === "fixed"
            ? { ...position } : { mode: "character", offset_x: position?.offset_x ?? 0, offset_y: position?.offset_y ?? 0 };
          onChange({ bubble_position: { ...next, [key]: n } });
        }} />
    </label>;
  };
  return <>
    <label>{command.type === "dialog" ? "对白呈现方式" : "旁白呈现方式"} <FieldHelp field="presentation_mode" />
      <RichSelect ariaLabel={command.type === "dialog" ? "对白呈现方式" : "旁白呈现方式"}
        value={command.presentation_mode ?? "inherit"} variant="compact"
        options={[{ value: "inherit", label: command.type === "dialog" ? "继承角色 / 工程默认" : "继承工程默认" }, ...modes]}
        onChange={value => onChange({ presentation_mode: value === "inherit" ? undefined : value as DialogPresentationMode })} />
    </label>
    <output data-testid="dialog-presentation-source">{source} · {modes.find(mode => mode.value === effective)?.label}</output>
    {characterId && <label>角色默认呈现方式
      <RichSelect ariaLabel="角色默认呈现方式" variant="compact" value={characterMode ?? "inherit"}
        options={[{ value: "inherit", label: "继承工程默认" }, ...modes]}
        onChange={value => setCharacterMode(characterId, value === "inherit" ? undefined : value as DialogPresentationMode)} />
      <small>只影响未显式指定呈现方式的“{characterId}”对白。</small>
    </label>}
    {effective === "nvl" && <label className="nvl-clear-page-toggle">
      <input type="checkbox" checked={Boolean(command.clear_nvl_page_before)}
        data-help-key="command.nvl.clearPage"
        onChange={event => onChange({ clear_nvl_page_before: event.target.checked })} />
      <span>显示本句前清空 NVL 页面</span><FieldHelp field="clear_nvl_page_before" />
    </label>}
    {effective === "bubble" && <fieldset className="dialog-bubble-position-fields">
      <legend>气泡定位</legend>
      <label>锚点
        <RichSelect ariaLabel="气泡锚点" variant="compact" value={fixed ? "fixed" : "character"}
          options={[{ value: "character", label: "跟随发言角色" }, { value: "fixed", label: "固定屏幕位置" }]}
          onChange={value => onChange({ bubble_position: value === "fixed"
            ? { mode: "fixed", x: 50, y: 20 } : { mode: "character", offset_x: 0, offset_y: 0 } })} />
      </label>
      {fixed ? <>{field("x", "气泡水平位置（%）")}{field("y", "气泡垂直位置（%）")}</>
        : <>{field("offset_x", "气泡水平偏移（%）")}{field("offset_y", "气泡垂直偏移（%）")}</>}
      <small>相对于游戏画面；自动避让安全边缘和快捷栏。角色不在场时显示于上部安全位置。</small>
    </fieldset>}
  </>;
}
