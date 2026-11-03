import { cloneElement, Fragment, useId, useMemo, useState, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { compileControlPresentation } from "../../../shared/cartridge/controlPresentation";
import type { CustomComponentDefinition, CustomComponentNode } from "../../../shared/cartridge/customComponent";
import type { UILayoutComponent, UILayoutComponentStyle, UISkinLayout } from "../../../shared/cartridge/uiSkin";
import { assetIdFromUILayoutReference } from "../../../shared/cartridge/uiAssetReference";
import { toRuntimeAssetUrl } from "../utils/runtimeAssetUrl";

const camel = (key: string) => key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
function cssProperties(values: Record<string, string> = {}, scale: number): CSSProperties {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    camel(key), value.replace(/(\d+(?:\.\d+)?)px\b/g, (_, number: string) => `${Number(number) * scale}px`),
  ]));
}

function authoredStyle(style: UILayoutComponentStyle | undefined, urls: Record<string, string | undefined>, scale: number): CSSProperties {
  if (!style) return {};
  const value: CSSProperties = {};
  for (const key of ["backgroundColor", "color", "borderColor", "fontWeight", "fontStyle", "textAlign", "opacity"] as const)
    if (style[key] !== undefined) Object.assign(value, { [key]: style[key] });
  for (const key of ["borderWidth", "borderRadius", "fontSize", "padding", "gap"] as const)
    if (style[key] !== undefined) Object.assign(value, { [key]: style[key]! * scale });
  if (style.borderWidth !== undefined) value.borderStyle = "solid";
  if (style.shadow === "none") value.boxShadow = "none";
  if (style.backgroundImage) {
    const id = assetIdFromUILayoutReference(style.backgroundImage);
    const source = id ? toRuntimeAssetUrl(urls[id]) : undefined;
    if (source) Object.assign(value, { backgroundImage: `url(${JSON.stringify(source)})`,
      backgroundRepeat: "no-repeat", backgroundPosition: "center",
      backgroundSize: style.backgroundFit === "stretch" ? "100% 100%" : style.backgroundFit ?? "cover" });
  }
  return value;
}

function presentationContent(node: CustomComponentNode, content: ReactNode, urls: Record<string, string | undefined>, key: string, scope: string): ReactNode {
  if (node.tag === "slot") return <Fragment key={key}>{content}</Fragment>;
  if (node.tag === "img") return <img key={key} data-control-node={scope} className={node.className} alt={node.ariaLabel ?? ""}
    src={node.assetId ? toRuntimeAssetUrl(urls[node.assetId]) : undefined} />;
  const Tag = node.tag;
  return <Tag key={key} data-control-node={scope} className={node.className} aria-label={node.ariaLabel}>
    {node.text ?? node.children.map((child, index) => presentationContent(child, content, urls, `${key}.${index}`, scope))}
  </Tag>;
}

function innerStyles(definition: CustomComponentDefinition | undefined, scope: string, scale: number,
  stateStyles: UILayoutComponent["stateStyles"], urls: Record<string, string | undefined>) {
  // Native theme rules use !important for e.g. Ren'Py choice states. This
  // renderer-owned cascade layer gives only validated code declarations their
  // promised priority over those defaults, without accepting author !important.
  const stateSelectors = {
    normal: "",
    hover: ":where(:not(:disabled):not([aria-disabled=true]):not([aria-current=page]):not([aria-current=true]):not([aria-pressed=true]):is(:hover,:focus-visible))",
    selected: ":where(:is([aria-current=page],[aria-current=true],[aria-pressed=true]))",
    disabled: ":where(:is(:disabled,[aria-disabled=true]))",
  };
  // CSS owns actual states, including a disabled button becoming enabled under
  // a stationary pointer (which does not dispatch React mouseenter).
  const stateRules = (Object.entries(stateSelectors) as [keyof typeof stateSelectors, string][])
    .map(([state, selector]) => `[data-control-state="${scope}"]${selector}{${Object.entries(
      authoredStyle(stateStyles?.[state], urls, scale))
      .filter(([, value]) => value !== undefined).map(([key, value]) => {
      const property = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      const cssValue = typeof value === "number" && !["opacity", "fontWeight"].includes(key) ? `${value}px` : value;
      return `${property}:${cssValue} !important`;
    }).join(";")}}`).join("\n");
  const rootRules = Object.entries(definition?.styles ?? {}).filter(([selector]) => selector.startsWith(".root"))
    .map(([selector, declarations]) => `[data-control-presentation="${scope}"]${selector.slice(5)}{${Object.entries(declarations)
      .map(([key, value]) => `${key}:${value.replace(/(\d+(?:\.\d+)?)px\b/g,
        (_, number: string) => `${Number(number) * scale}px`)} !important`).join(";")}}`).join("\n");
  const childRules = Object.entries(definition?.styles ?? {}).filter(([selector]) => !selector.startsWith(".root")).map(([selector, declarations]) =>
    `[data-control-node="${scope}"]${selector}{${Object.entries(declarations).map(([key, value]) =>
      `${key}:${value.replace(/(\d+(?:\.\d+)?)px\b/g, (_, number: string) => `${Number(number) * scale}px`)}`).join(";")}}`).join("\n");
  return `@layer agentvn-control-code {${stateRules}\n${rootRules}}\n${childRules}`;
}

/** Clone the functional native root; do not move DOM behind React or replace its handlers. */
export function PresentedControl({ layout, component, assetUrls = {}, scale = 1, children, applyBaseStyle = true }: {
  layout: UISkinLayout;
  component?: UILayoutComponent;
  assetUrls?: Record<string, string | undefined>;
  scale?: number;
  applyBaseStyle?: boolean;
  children: ReactElement<HTMLAttributes<HTMLElement> & { disabled?: boolean }>;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const [hover, setHover] = useState(false), [focused, setFocused] = useState(false);
  const source = layout.advancedPresentationEnabled ? component?.presentation : undefined;
  const parsed = useMemo(() => source ? compileControlPresentation(source) : undefined, [source]);
  const definition = parsed?.ok ? parsed.definition : undefined;
  if (!component) return children;
  const root = definition?.root;
  const styles = definition?.styles;
  const disabled = Boolean(children.props.disabled);
  const selected = children.props["aria-current"] === "page" || children.props["aria-current"] === "true"
    || children.props["aria-current"] === true || children.props["aria-pressed"] === true;
  const nativeStateStyle = { ...component.stateStyles?.normal,
    ...component.stateStyles?.[disabled ? "disabled" : selected ? "selected" : hover || focused ? "hover" : "normal"] };
  const resolvedStateStyle = authoredStyle(nativeStateStyle, assetUrls, scale);
  const style: CSSProperties = {
    ...children.props.style,
    ...(applyBaseStyle ? authoredStyle(component.style, assetUrls, scale) : {}),
    ...resolvedStateStyle,
    ...cssProperties(styles?.[".root"], scale),
    ...cssProperties(!disabled && hover ? styles?.[".root:hover"] : undefined, scale),
    ...cssProperties(!disabled && focused ? styles?.[".root:focus-visible"] : undefined, scale),
    ...cssProperties(disabled ? styles?.[".root:disabled"] : undefined, scale),
  };
  const props = {
    style,
    "data-ui-component-id": component.component_id,
    "data-control-presentation": definition ? id : undefined,
    "data-control-state": component.stateStyles ? id : undefined,
    "data-control-slot-count": definition ? "1" : undefined,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => { setHover(true); children.props.onMouseEnter?.(event); },
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) => { setHover(false); children.props.onMouseLeave?.(event); },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      setFocused(event.target.matches(":focus-visible")); children.props.onFocus?.(event);
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); children.props.onBlur?.(event); },
    children: root ? root.children.map((node, index) => presentationContent(node, children.props.children, assetUrls, `${id}.${index}`, id))
      : children.props.children,
  };
  return <>{(definition || component.stateStyles) && <style>{innerStyles(definition, id, scale, component.stateStyles, assetUrls)}</style>}
    {cloneElement(children, props)}</>;
}
