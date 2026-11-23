import type { CustomComponentDefinition, CustomComponentNode } from "./customComponent";
import { validateCustomComponentDefinition } from "./customComponent";
import { parseCustomComponentMarkup } from "./customComponentMarkup";
import type { UILayoutComponentStyle, UISkinLayout } from "./uiSkin";

export interface ControlPresentationSource {
  version: 1;
  html: string;
  css: string;
}

/** Enumerate only protocol-owned source fields, never arbitrary objects or metadata. */
export function layoutPresentationTargets(layout: UISkinLayout) {
  const targets: { path: string; key: string; source: ControlPresentationSource;
    set: (source?: ControlPresentationSource) => void }[] = [];
  for (const [screenIndex, screen] of layout.screens.entries())
    for (const [index, component] of screen.components.entries()) if (component.presentation !== undefined)
      targets.push({ path: `ui.screens.${screenIndex}.components.${index}.presentation`, key: `${screen.screen_id}:${component.component_id}`,
        source: component.presentation, set: source => { component.presentation = source; } });
  const configs = [
    { path: "ui.confirmationLayout", config: layout.confirmationLayout,
      keys: ["panelPresentation", "titlePresentation", "textPresentation"] as const },
    ...(["nvl", "bubble"] as const).map(mode => ({
      path: `ui.dialogueLayouts.${mode}`, config: layout.dialogueLayouts?.[mode],
      keys: ["panelPresentation", "textPresentation", "speakerPresentation"] as const,
    })),
  ];
  for (const { path, config, keys } of configs) if (config && typeof config === "object") {
    // All optional source fields have the same protocol. Styles/geometry stay separate.
    const record = config as Partial<Record<typeof keys[number], ControlPresentationSource>>;
    for (const key of keys) if (record[key] !== undefined)
      targets.push({ path: `${path}.${key}`, key: `${path}.${key}`, source: record[key]!,
        set: source => { if (source === undefined) delete record[key]; else record[key] = source; } });
  }
  return targets;
}

export const DEFAULT_CONTROL_PRESENTATION: ControlPresentationSource = {
  version: 1,
  html: '<span class="root">\n  <slot name="content"></slot>\n</span>',
  css: ".root {\n  border-radius: 6px;\n}",
};

const graphicalProperties: Partial<Record<keyof UILayoutComponentStyle, string>> = {
  backgroundColor: "background-color", color: "color", borderColor: "border-color",
  borderWidth: "border-width", borderRadius: "border-radius", fontSize: "font-size",
  fontWeight: "font-weight", textAlign: "text-align", padding: "padding", gap: "gap", opacity: "opacity",
};

/** Read-through values only: inspecting code never rewrites the graphical base. */
export function controlPresentationOverrides(source: ControlPresentationSource | undefined, enabled: boolean,
  state: "normal" | "hover" | "selected" | "disabled" = "normal"): Partial<Record<keyof UILayoutComponentStyle, string>> {
  if (!enabled || !source) return {};
  const parsed = compileControlPresentation(source);
  if (!parsed.ok || !parsed.definition) return {};
  const styles = parsed.definition.styles;
  const declarations = { ...styles[".root"],
    ...(state === "hover" ? styles[".root:hover"] : state === "disabled" ? styles[".root:disabled"] : {}) };
  return Object.fromEntries(Object.entries(graphicalProperties).flatMap(([key, property]) =>
    declarations[property] === undefined ? [] : [[key, declarations[property]]]));
}

/** The native root keeps its actions, state, accessible identity and listeners.
 * Only its content structure and explicitly authored properties are replaced. */
export function compileControlPresentation(source: unknown): {
  ok: boolean; definition?: CustomComponentDefinition; issues: string[];
} {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { ok: false, issues: ["控件代码必须是版本化的 HTML/CSS 对象。"] };
  }
  const record = source as Partial<ControlPresentationSource>;
  if (record.version !== 1 || typeof record.html !== "string" || typeof record.css !== "string"
    || Object.keys(source).some(key => !["version", "html", "css"].includes(key))) {
    return { ok: false, issues: ["控件代码版本、HTML 或 CSS 字段无效。"] };
  }
  const parsed = parseCustomComponentMarkup(record.html, record.css, { contentSlot: true });
  if (!parsed.ok || !parsed.component) return { ok: false, issues: parsed.issues };
  const definition = parsed.component;
  const issues = validateCustomComponentDefinition(definition, { contentSlot: true });
  let slots = 0;
  const visit = (node: CustomComponentNode) => {
    if (node.tag === "slot") {
      slots++;
      if (node.children.length || node.binding || node.text || node.assetId || node.action)
        issues.push("功能插槽必须为空，其内容由原生控件提供。");
    }
    if (node.tag === "button" || node.tag === "label" || node.action || node.binding)
      issues.push("内建控件代码不能另建交互动作或数据绑定；请保留原生功能内容插槽。");
    node.children.forEach(visit);
  };
  visit(definition.root);
  const stableStateProperties = new Set(["color", "background-color", "border-color", "border-radius", "opacity"]);
  for (const [selector, declarations] of Object.entries(definition.styles)) {
    if (!selector.includes(":")) continue;
    for (const property of Object.keys(declarations)) if (!stableStateProperties.has(property))
      issues.push(`状态样式 ${selector} 的 ${property} 会改变内容或命中范围；请移到无状态选择器中，状态仅修改颜色、圆角或透明度。`);
  }
  if (!["div", "span"].includes(definition.root.tag))
    issues.push("控件外观根节点必须为 div 或 span；实际原生根节点保持不变。");
  if (slots !== 1) issues.push("必须且只能保留一个 <slot name=\"content\"></slot> 功能内容插槽。");
  return issues.length ? { ok: false, issues } : { ok: true, definition, issues: [] };
}

/** Derived game/preview layout. Never discard source code from the project. */
export function resolveLayoutPresentations(layout: UISkinLayout): UISkinLayout {
  const resolved = structuredClone(layout);
  if (!resolved.advancedPresentationEnabled) {
    for (const target of layoutPresentationTargets(resolved)) target.set();
  }
  return resolved;
}
