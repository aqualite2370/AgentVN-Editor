export type CustomComponentTag = "div" | "span" | "p" | "label" | "button" | "img" | "slot";
export type CustomComponentAction =
  | "start_game"
  | "open_save_load"
  | "open_preferences"
  | "open_history"
  | "open_gallery"
  | "open_about"
  | "open_help"
  | "close_menu"
  | "rollback"
  | "toggle_auto"
  | "toggle_skip"
  | "quick_save"
  | "quick_load";
export type CustomComponentBinding =
  | "project.title"
  | "project.author"
  | "asset.display_name"
  | "asset.filename"
  | "runtime.scene_title"
  | "runtime.speaker";

export interface CustomComponentNode {
  tag: CustomComponentTag;
  className?: string;
  ariaLabel?: string;
  binding?: CustomComponentBinding;
  action?: CustomComponentAction;
  assetId?: string;
  text?: string;
  children: CustomComponentNode[];
}

export interface CustomComponentDefinition {
  schemaVersion: 1;
  root: CustomComponentNode;
  styles: Record<string, Record<string, string>>;
}

/**
 * Return image dependencies in the same order in which they appear in the
 * component tree. The first one is the component's primary asset for the
 * asset.display_name / asset.filename bindings.
 */
export function referencedCustomComponentAssetIds(
  definition: Pick<CustomComponentDefinition, "root">,
): string[] {
  const assetIds: string[] = [];
  const visit = (node: CustomComponentNode) => {
    if (node.tag === "img" && node.assetId && !assetIds.includes(node.assetId)) {
      assetIds.push(node.assetId);
    }
    node.children.forEach(visit);
  };
  visit(definition.root);
  return assetIds;
}

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
const COLOR = /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\)|transparent|currentColor|black|white)$/i;
const LENGTH = /^(?:0|(?:\d+(?:\.\d+)?)(?:px|rem|em|%|vh|vw))$/;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateStyleValue(property: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /(?:url\s*\(|expression\s*\(|var\s*\(|calc\s*\(|javascript:|data:|!important)/i.test(trimmed))
    return false;
  if (["color", "background-color", "border-color"].includes(property)) return COLOR.test(trimmed);
  if (["gap", "width", "height", "min-width", "min-height", "max-width", "max-height",
    "border-width", "border-radius", "font-size", "margin", "margin-inline", "margin-block",
    "padding", "padding-inline", "padding-block", "line-height"].includes(property)) {
    const values = trimmed.split(/\s+/);
    return values.length <= 4 && values.every((part) => LENGTH.test(part));
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

/**
 * Revalidate persisted component ASTs at the cartridge boundary. Library and
 * ZIP data are untrusted once serialized; Runtime must only receive this subset.
 */
export function validateCustomComponentDefinition(value: unknown, options: { contentSlot?: boolean } = {}): string[] {
  const issues: string[] = [];
  if (!plainRecord(value) || value.schemaVersion !== 1 || !plainRecord(value.styles)) {
    return ["自定义组件结构版本或根节点无效。"];
  }

  let nodeCount = 0;
  const visit = (candidate: unknown, depth: number, isRoot: boolean) => {
    if (!plainRecord(candidate)) {
      issues.push("组件包含无效节点。");
      return;
    }
    nodeCount++;
    if (nodeCount > 256) issues.push("组件节点数超过安全上限。");
    if (depth > 16) issues.push("组件嵌套深度超过安全上限。");
    const allowedKeys = new Set(["tag", "className", "ariaLabel", "binding", "action", "assetId", "text", "children"]);
    if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) issues.push("组件节点包含未支持字段。");
    if (typeof candidate.tag !== "string" || (!TAGS.has(candidate.tag as CustomComponentTag)
      && !(options.contentSlot && candidate.tag === "slot")))
      issues.push("组件包含未支持标签。");
    if (candidate.className !== undefined
      && (typeof candidate.className !== "string" || !CLASSES.has(candidate.className)))
      issues.push("组件包含未支持样式类。");
    if (candidate.ariaLabel !== undefined
      && (typeof candidate.ariaLabel !== "string" || candidate.ariaLabel.length > 160))
      issues.push("组件无障碍名称无效。");
    if (candidate.binding !== undefined
      && (typeof candidate.binding !== "string" || !BINDINGS.has(candidate.binding as CustomComponentBinding)))
      issues.push("组件绑定字段不在授权清单中。");
    if (candidate.action !== undefined
      && (typeof candidate.action !== "string" || !ACTIONS.has(candidate.action as CustomComponentAction)))
      issues.push("组件动作不在白名单中。");
    if (candidate.action !== undefined && candidate.tag !== "button")
      issues.push("白名单动作只能绑定到按钮。");
    if (candidate.tag === "button" && candidate.action === undefined)
      issues.push("组件按钮必须绑定明确的白名单动作。");
    if (candidate.assetId !== undefined
      && (candidate.tag !== "img" || typeof candidate.assetId !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(candidate.assetId)))
      issues.push("素材编号只能用于图片节点，且必须是安全编号。");
    if (candidate.tag === "img" && candidate.assetId === undefined)
      issues.push("图片节点必须绑定组件包中声明的素材编号。");
    if (candidate.tag === "img" && Array.isArray(candidate.children) && candidate.children.length > 0)
      issues.push("图片节点不能包含子节点。");
    if (candidate.text !== undefined
      && (typeof candidate.text !== "string" || candidate.text.length > 4096))
      issues.push("组件文本无效或超过长度上限。");
    if (!Array.isArray(candidate.children)) {
      issues.push("组件子节点必须是数组。");
    } else {
      for (const child of candidate.children) visit(child, depth + 1, false);
    }
    if (isRoot && ((candidate.tag !== "div" && !(options.contentSlot && candidate.tag === "span")) || candidate.className !== "root"))
      issues.push("组件根节点必须是 div.root。");
  };
  visit(value.root, 1, true);
  if (nodeCount < 1) issues.push("组件缺少根节点。");

  const styles = value.styles;
  for (const [selector, declarations] of Object.entries(styles)) {
    if (!SELECTOR.test(selector)) {
      issues.push(`组件选择器“${selector}”不在安全子集中。`);
      continue;
    }
    if (!plainRecord(declarations)) {
      issues.push(`组件选择器“${selector}”的样式无效。`);
      continue;
    }
    for (const [property, styleValue] of Object.entries(declarations)) {
      if (!STYLE_PROPERTIES.has(property) || typeof styleValue !== "string"
        || !validateStyleValue(property, styleValue)) {
        issues.push(`组件样式“${property}”不受支持或不安全。`);
      }
    }
  }
  return [...new Set(issues)];
}

export function isCustomComponentDefinition(value: unknown): value is CustomComponentDefinition {
  return validateCustomComponentDefinition(value).length === 0;
}
