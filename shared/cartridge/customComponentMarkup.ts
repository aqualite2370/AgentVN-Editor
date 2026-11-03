import type {
  CustomComponentAction,
  CustomComponentBinding,
  CustomComponentDefinition,
  CustomComponentNode,
  CustomComponentTag,
} from "./customComponent";
export type {
  CustomComponentAction,
  CustomComponentBinding,
  CustomComponentDefinition,
  CustomComponentNode,
  CustomComponentTag,
} from "./customComponent";

export interface CustomComponentMarkupResult {
  ok: boolean;
  component?: CustomComponentDefinition;
  issues: string[];
}

const MAX_MARKUP_LENGTH = 32_000;
const MAX_NODES = 256;
const MAX_DEPTH = 16;
const TAGS = new Set<CustomComponentTag>(["div", "span", "p", "label", "button", "img"]);
const CLASSES = new Set(["root", "title", "body", "button", "label", "group", "icon"]);
const ACTIONS = new Set<CustomComponentAction>([
  "start_game", "open_save_load", "open_preferences", "open_history", "open_gallery",
  "open_about", "open_help", "close_menu", "rollback", "toggle_auto", "toggle_skip",
  "quick_save", "quick_load",
]);
const BINDINGS = new Set<CustomComponentBinding>([
  "project.title", "project.author", "asset.display_name", "asset.filename",
  "runtime.scene_title", "runtime.speaker",
]);
const STYLE_PROPERTIES = new Set([
  "display", "flex-direction", "align-items", "justify-content", "gap",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "padding", "padding-inline", "padding-block", "margin", "margin-inline",
  "margin-block", "color", "background-color", "border-color", "border-width",
  "border-style", "border-radius", "font-size", "font-weight", "line-height",
  "text-align", "white-space", "opacity", "flex", "overflow", "object-fit",
]);
const SELECTOR = /^\.(root|title|body|button|label|group|icon)(?::(hover|focus-visible|disabled))?$/;
const SAFE_COLOR = /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\)|transparent|currentColor|black|white)$/i;
const SAFE_LENGTH = /^(?:0|(?:\d+(?:\.\d+)?)(?:px|rem|em|%|vh|vw))$/;

function failure(...issues: string[]): CustomComponentMarkupResult {
  return { ok: false, issues };
}

function parseAttributes(source: string): Record<string, string> | undefined {
  const attributes: Record<string, string> = {};
  let rest = source.trim();
  while (rest) {
    const match = /^([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/.exec(rest);
    if (!match) return undefined;
    const name = match[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(attributes, name)) return undefined;
    attributes[name] = match[2] ?? match[3] ?? "";
    rest = rest.slice(match[0].length);
  }
  return attributes;
}

function safeStyleValue(property: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /(?:url\s*\(|expression\s*\(|var\s*\(|calc\s*\(|javascript:|data:|!important)/i.test(trimmed))
    return false;
  if (["color", "background-color", "border-color"].includes(property)) return SAFE_COLOR.test(trimmed);
  if (["gap", "width", "height", "min-width", "min-height", "max-width", "max-height",
    "border-width", "border-radius", "font-size", "margin", "margin-inline", "margin-block",
    "padding", "padding-inline", "padding-block", "line-height"].includes(property)) {
    return trimmed.split(/\s+/).length <= 4
      && trimmed.split(/\s+/).every((part) => SAFE_LENGTH.test(part));
  }
  if (property === "opacity") {
    const number = Number(trimmed);
    return Number.isFinite(number) && number >= 0 && number <= 1;
  }
  if (property === "font-weight") return /^(?:normal|bold|[1-9]00)$/.test(trimmed);
  if (property === "display") return ["flex", "grid", "block", "inline", "inline-flex", "none"].includes(trimmed);
  if (property === "flex-direction") return ["row", "column", "row-reverse", "column-reverse"].includes(trimmed);
  if (property === "align-items") return ["start", "end", "center", "stretch", "baseline"].includes(trimmed);
  if (property === "justify-content") return ["start", "end", "center", "space-between", "space-around", "space-evenly"].includes(trimmed);
  if (property === "text-align") return ["left", "right", "center", "start", "end"].includes(trimmed);
  if (property === "white-space") return ["normal", "nowrap", "pre-wrap"].includes(trimmed);
  if (property === "border-style") return ["none", "solid", "dashed", "dotted"].includes(trimmed);
  if (property === "overflow") return ["visible", "hidden", "auto"].includes(trimmed);
  if (property === "object-fit") return ["contain", "cover", "fill", "none", "scale-down"].includes(trimmed);
  if (property === "flex") return /^(?:none|auto|[0-9]+(?:\s+[0-9]+(?:\s+(?:0|[0-9.]+(?:px|%|em|rem)))?)?)$/.test(trimmed);
  return false;
}

function parseCss(source: string, issues: string[]): Record<string, Record<string, string>> {
  const styles: Record<string, Record<string, string>> = {};
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!css) return styles;
  if (css.includes("/*") || css.includes("*/") || css.includes("@")) {
    issues.push("CSS 注释格式错误或 at-rule 不受支持。");
    return styles;
  }
  let consumed = 0;
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(rulePattern)) {
    const index = match.index ?? 0;
    if (css.slice(consumed, index).trim()) issues.push("CSS 包含无法解析的规则或括号。");
    consumed = index + match[0].length;
    const selector = match[1].trim();
    if (!SELECTOR.test(selector)) {
      issues.push(`选择器“${selector}”不在安全子集中。`);
      continue;
    }
    const declarations: Record<string, string> = {};
    for (const declaration of match[2].split(";")) {
      if (!declaration.trim()) continue;
      const colon = declaration.indexOf(":");
      if (colon <= 0) {
        issues.push(`CSS 声明“${declaration.trim()}”格式无效。`);
        continue;
      }
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (!STYLE_PROPERTIES.has(property) || !safeStyleValue(property, value)) {
        issues.push(`CSS 属性或值“${property}: ${value}”不受支持或不安全。`);
        continue;
      }
      declarations[property] = value;
    }
    styles[selector] = { ...(styles[selector] ?? {}), ...declarations };
  }
  if (css.slice(consumed).trim()) issues.push("CSS 包含无法解析的规则或括号。");
  return styles;
}

export function parseCustomComponentMarkup(html: string, css: string, options: { contentSlot?: boolean } = {}): CustomComponentMarkupResult {
  const issues: string[] = [];
  if (html.length + css.length > MAX_MARKUP_LENGTH) return failure("组件标记或样式超过 32 KB 限制。");

  const syntheticRoot: CustomComponentNode = { tag: "div", children: [] };
  const stack: Array<{ node: CustomComponentNode; sourceTag: string }> = [{ node: syntheticRoot, sourceTag: "#root" }];
  let nodeCount = 0;
  const tokens = html.match(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+|</g) ?? [];
  if (tokens.join("") !== html) issues.push("HTML 包含无法解析的标记。");

  for (const token of tokens) {
    if (token.startsWith("<!--")) {
      issues.push("HTML 注释不在支持子集中。");
      continue;
    }
    if (!token.startsWith("<")) {
      if (!token) continue;
      const parent = stack[stack.length - 1]?.node;
      if (!parent) continue;
      if (token.trim()) {
        const last = parent.children[parent.children.length - 1];
        if (last?.tag === "span" && last.text !== undefined && !last.className && !last.binding && !last.action) {
          last.text += token;
        } else {
          parent.children.push({ tag: "span", text: token, children: [] });
          nodeCount++;
        }
      }
      continue;
    }
    const closing = /^<\/([A-Za-z][\w-]*)\s*>$/.exec(token);
    if (closing) {
      const tag = closing[1].toLowerCase();
      if (stack.length <= 1 || stack[stack.length - 1]?.sourceTag !== tag) {
        issues.push(`结束标签 </${tag}> 与当前结构不匹配。`);
      } else {
        stack.pop();
      }
      continue;
    }
    const opening = /^<([A-Za-z][\w-]*)([\s\S]*?)>$/.exec(token);
    if (!opening) {
      issues.push(`标记“${token.slice(0, 40)}”格式无效。`);
      continue;
    }
    const sourceTag = opening[1].toLowerCase();
    if (!TAGS.has(sourceTag as CustomComponentTag) && !(options.contentSlot && sourceTag === "slot")) {
      issues.push(`标签 <${sourceTag}> 不在安全子集中。`);
      continue;
    }
    const selfClosing = /\/\s*>$/.test(token);
    const attrSource = opening[2].replace(/\/\s*$/, "");
    const attributes = parseAttributes(attrSource);
    if (!attributes) {
      issues.push(`<${sourceTag}> 的属性格式无效或存在重复属性。`);
      continue;
    }
    const allowedAttributes = new Set(["class", "type", "data-bind", "data-action", "data-asset", "aria-label"]);
    if (options.contentSlot && sourceTag === "slot") allowedAttributes.add("name");
    for (const name of Object.keys(attributes)) {
      if (!allowedAttributes.has(name)) issues.push(`属性“${name}”不受支持。`);
    }
    if (sourceTag === "slot" && attributes.name !== "content")
      issues.push("内建控件只支持 name=\"content\" 的功能内容插槽。");
    const className = attributes.class;
    if (className && !CLASSES.has(className)) issues.push(`class“${className}”不在安全子集中。`);
    if (sourceTag === "button" && attributes.type && attributes.type !== "button")
      issues.push("按钮只能使用 type=\"button\"。");
    if (sourceTag !== "button" && attributes.type)
      issues.push("type 属性只能用于 button 节点。");
    if (sourceTag === "img" && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(attributes["data-asset"] ?? ""))
      issues.push("图片节点必须指定安全的 data-asset 素材编号。");
    if (sourceTag !== "img" && attributes["data-asset"])
      issues.push("data-asset 只能用于 img 图片节点。");
    if (sourceTag === "button" && !attributes["data-action"])
      issues.push("按钮必须绑定一个明确的 AgentVN 白名单动作。");
    if (sourceTag !== "button" && attributes["data-action"])
      issues.push("AgentVN 动作只能绑定到 button 节点。");
    if (attributes["data-bind"] && !BINDINGS.has(attributes["data-bind"] as CustomComponentBinding))
      issues.push(`数据绑定“${attributes["data-bind"]}”不在授权字段清单中。`);
    if (attributes["data-action"] && !ACTIONS.has(attributes["data-action"] as CustomComponentAction))
      issues.push(`动作“${attributes["data-action"]}”不在 AgentVN 白名单中。`);
    const node: CustomComponentNode = {
      tag: sourceTag as CustomComponentTag,
      ...(className && CLASSES.has(className) ? { className } : {}),
      ...(attributes["aria-label"] ? { ariaLabel: attributes["aria-label"] } : {}),
      ...(attributes["data-bind"] && BINDINGS.has(attributes["data-bind"] as CustomComponentBinding)
        ? { binding: attributes["data-bind"] as CustomComponentBinding } : {}),
      ...(attributes["data-action"] && ACTIONS.has(attributes["data-action"] as CustomComponentAction)
        ? { action: attributes["data-action"] as CustomComponentAction } : {}),
      ...(sourceTag === "img" && attributes["data-asset"] ? { assetId: attributes["data-asset"] } : {}),
      children: [],
    };
    const parent = stack[stack.length - 1]?.node;
    if (!parent) continue;
    parent.children.push(node);
    nodeCount++;
    if (nodeCount > MAX_NODES) issues.push(`组件节点数超过 ${MAX_NODES} 个限制。`);
    if (!selfClosing && sourceTag !== "img") {
      if (stack.length >= MAX_DEPTH) issues.push(`组件嵌套深度超过 ${MAX_DEPTH} 层限制。`);
      else stack.push({ node, sourceTag });
    }
  }
  if (stack.length !== 1) issues.push("HTML 有未闭合标签。");
  if (syntheticRoot.children.length !== 1 || syntheticRoot.children[0]?.className !== "root")
    issues.push("组件必须包含唯一的 class=\"root\" 根节点。");

  const styles = parseCss(css, issues);
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    component: { schemaVersion: 1, root: syntheticRoot.children[0], styles },
    issues: [],
  };
}
