import { useMemo, useState } from "react";
import {
  RENPY_BUTTON_ROLES,
  RENPY_BUTTON_STATES,
  resolveRenpyButtonRole,
  type RenpyButtonRole,
  type RenpyButtonRoleGeometry,
  type RenpyButtonRolePage,
  type RenpyButtonRoleStateStyle,
  type RenpyButtonState,
} from "../../../../shared/cartridge/renpyGui";
import type { UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { RichSelect } from "../common/RichSelect";

const roleLabels: Record<RenpyButtonRole, string> = {
  title_action: "标题操作",
  page_navigation: "页面导航",
  category_pagination: "分类 / 分页",
  story_choice: "剧情选项",
  quick_bar: "快捷栏",
  modal_action: "弹窗操作",
};
const stateLabels: Record<RenpyButtonState, string> = {
  normal: "普通",
  hover: "悬停",
  selected: "选中",
  disabled: "禁用",
};
const geometryFields: Array<[keyof RenpyButtonRoleGeometry, string]> = [
  ["width", "按钮宽度"],
  ["height", "按钮高度"],
  ["fontSize", "按钮字号"],
  ["paddingX", "水平内边距"],
  ["paddingY", "垂直内边距"],
];
const colorFields: Array<[keyof Pick<RenpyButtonRoleStateStyle, "textColor" | "backgroundColor" | "borderColor">, string]> = [
  ["textColor", "按钮文字色"],
  ["backgroundColor", "按钮背景色"],
  ["borderColor", "按钮边框色"],
];

export function RenpyButtonRoleEditor({ draft, page, roles = RENPY_BUTTON_ROLES, onChange }: {
  draft: UISkinLayout;
  page: RenpyButtonRolePage;
  roles?: readonly RenpyButtonRole[];
  onChange: (layout: UISkinLayout) => void;
}) {
  const [role, setRole] = useState<RenpyButtonRole>(roles[0]);
  const [state, setState] = useState<RenpyButtonState>("normal");
  const [scope, setScope] = useState<"shared" | "page">("page");
  const gui = draft.renpy;
  const rolePage: RenpyButtonRolePage = role === "story_choice" || role === "quick_bar" ? "player" : page;
  // Editing shared values must not display a page override as the shared
  // baseline. Runtime still resolves shared + active page for presentation.
  const resolved = useMemo(() => resolveRenpyButtonRole(
    scope === "shared" ? { shared: gui?.shared } : gui, role, rolePage,
  ), [gui, role, rolePage, scope]);
  const selectedConfig = gui?.[scope === "shared" ? "shared" : rolePage]?.buttonRoles?.[role];
  const roleConfig = gui?.[rolePage]?.buttonRoles?.[role];

  const updateGeometry = (key: keyof RenpyButtonRoleGeometry, value: number) => {
    const next = structuredClone(draft);
    next.renpy ??= {};
    const target = next.renpy[scope === "shared" ? "shared" : rolePage] ??= {};
    const roles = target.buttonRoles ??= {};
    const current = roles[role] ??= {};
    current.geometry = { ...current.geometry, [key]: value };
    onChange(next);
  };
  const updateState = (key: keyof RenpyButtonRoleStateStyle, value: string | number) => {
    const next = structuredClone(draft);
    next.renpy ??= {};
    const target = next.renpy[scope === "shared" ? "shared" : rolePage] ??= {};
    const roles = target.buttonRoles ??= {};
    const current = roles[role] ??= {};
    const states = current.states ??= {};
    states[state] = { ...states[state], [key]: value };
    onChange(next);
  };
  const clearRole = () => {
    if (scope === "shared") {
      const next = structuredClone(draft);
      const roleMap = next.renpy?.shared?.buttonRoles;
      if (roleMap) {
        delete roleMap[role];
        if (!Object.keys(roleMap).length) delete next.renpy!.shared!.buttonRoles;
      }
      onChange(next);
      return;
    }
    const next = structuredClone(draft);
    const roleMap = next.renpy?.[rolePage]?.buttonRoles;
    if (roleMap) {
      delete roleMap[role];
      if (!Object.keys(roleMap).length) delete next.renpy![rolePage]!.buttonRoles;
      if (!Object.keys(next.renpy![rolePage]!).length) delete next.renpy![rolePage];
    }
    onChange(next);
  };

  return <section className="renpy-button-role-editor" data-testid="renpy-button-role-editor"
    data-role-page={rolePage}>
    <h4>按钮角色与状态</h4>
    <label>按钮角色
      <RichSelect ariaLabel="按钮角色" value={role} onChange={setRole}
        options={roles.map((id) => ({ value: id, label: roleLabels[id] }))} />
    </label>
    <label>编辑范围
      <RichSelect ariaLabel="按钮样式范围" value={scope} onChange={setScope}
        options={[{ value: "shared", label: "共享样式" }, {
          value: "page", label: rolePage === "player" ? "剧情页面覆盖" : "当前页面覆盖",
        }]} />
    </label>
    {rolePage === "player" && <small>此角色作用于剧情页，不修改当前菜单页。</small>}
    <div>当前来源：<output data-testid="renpy-title-button-role-source">
      {scope === "page" ? (roleConfig ? "覆盖" : "继承共享") : (selectedConfig ? "自定义" : "内置基准")}
    </output></div>
    <label>按钮状态
      <RichSelect ariaLabel="按钮状态" value={state} onChange={setState}
        options={RENPY_BUTTON_STATES.map((id) => ({ value: id, label: stateLabels[id] }))} />
    </label>
    <div className="renpy-button-role-grid">
      {geometryFields.map(([key, label]) => <label key={key}>{label}
        <input aria-label={label} type="number" min={key === "fontSize" ? 8 : 0}
          max={key === "fontSize" ? 128 : key === "width" ? 2048 : key === "height" ? 1024 : 256}
          value={resolved.geometry[key]} onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) updateGeometry(key, value);
          }} />
      </label>)}
    </div>
    {(role === "page_navigation" || role === "modal_action") && <small data-testid="renpy-role-sizing-source">
      {resolved.sizing.width === "content" ? "宽度：内置最小值，随文字扩展。" : "宽度：显式固定值。"}
      {resolved.sizing.height === "content" ? "高度：内置最小值，随文字扩展。" : "高度：显式固定值。"}
      设置宽高后按该轴的最大状态尺寸显示，不自动缩小字号。
    </small>}
    {colorFields.map(([key, label]) => {
      const value = resolved.states[state][key];
      return <label key={key}>{label}
        <input aria-label={label} type="color"
          value={typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : "#ffffff"}
          onChange={(event) => updateState(key, event.currentTarget.value)} />
      </label>;
    })}
    <label>边框宽度
      <input aria-label="按钮边框宽度" type="number" min={0} max={32} step={0.5}
        value={resolved.states[state].borderWidth ?? 0}
        onChange={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value)) updateState("borderWidth", value);
        }} />
    </label>
    <label>不透明度
      <input aria-label="按钮不透明度" type="number" min={0} max={1} step={0.05}
        value={resolved.states[state].opacity ?? 1}
        onChange={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value)) updateState("opacity", value);
        }} />
    </label>
    {scope === "page" && roleConfig && <button type="button" onClick={clearRole}>恢复此角色共享继承</button>}
    {scope === "shared" && selectedConfig && <button type="button" onClick={clearRole}>恢复内置基准</button>}
  </section>;
}
