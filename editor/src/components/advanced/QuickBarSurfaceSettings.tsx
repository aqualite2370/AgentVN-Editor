import type { UILayoutComponent, UILayoutComponentStyle } from "../../../../shared/cartridge/uiSkin";

export function QuickBarSurfaceSettings({ component, onChange }: {
  component: UILayoutComponent; onChange: (patch: Partial<UILayoutComponentStyle>) => void;
}) {
  if (component.component_type !== "quick_menu") return null;
  return <section className="renpy-property" aria-label="快捷栏背景">
    <label className="checkbox-row">
      <input type="checkbox" aria-label="快捷栏背景透明" disabled={component.locked}
        checked={component.style?.quickMenuTransparent === true}
        onChange={event => onChange({ quickMenuTransparent: event.currentTarget.checked })} />
      背景透明
    </label>
    <small>只隐藏栏的底色、背景图和边框；按钮外观单独设置。</small>
  </section>;
}
