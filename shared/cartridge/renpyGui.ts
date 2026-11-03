/** Static subset of the pinned template; never executable Ren'Py/Python. */
import { isUILayoutAssetReference } from "./uiAssetReference";

export const RENPY_TEMPLATE_VERSION = "8.5.3.26051504";
export interface RenpyNavigationStyle {
  x: number;
  fontSize: number;
  spacing: number;
}
export interface RenpySaveGridStyle {
  saveColumns: number;
  saveGap: number;
}
/** Logical 1280×720 template geometry, independent of the legacy library scope. */
export interface RenpyMenuFrameStyle {
  menuNavigationWidth: number;
  menuTopPadding: number;
  menuBottomPadding: number;
  menuContentLeft: number;
  menuContentRight: number;
  menuContentTop: number;
  menuTitleX: number;
  menuTitleFontSize: number;
}
export interface RenpyButtonBorders {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type RenpyGUIStyle = RenpyNavigationStyle & RenpySaveGridStyle & RenpyMenuFrameStyle;
export type RenpyButtonState = "normal" | "hover" | "selected" | "disabled";
export type RenpyButtonStateImages = Partial<Record<RenpyButtonState, string>>;
export type RenpyButtonStateColors = Partial<Record<RenpyButtonState, string>>;
export const RENPY_BUTTON_ROLES = [
  "title_action",
  "page_navigation",
  "category_pagination",
  "story_choice",
  "quick_bar",
  "modal_action",
] as const;
export type RenpyButtonRole = typeof RENPY_BUTTON_ROLES[number];
export interface RenpyButtonRoleGeometry {
  width?: number;
  height?: number;
  paddingX?: number;
  paddingY?: number;
  fontSize?: number;
}
export interface RenpyButtonRoleStateStyle {
  textColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
}
export interface RenpyButtonRoleState extends RenpyButtonRoleStateStyle {
  geometry?: RenpyButtonRoleGeometry;
}
export interface RenpyButtonRoleStyle {
  geometry?: RenpyButtonRoleGeometry;
  states?: Partial<Record<RenpyButtonState, RenpyButtonRoleState>>;
}
export interface ResolvedRenpyButtonRole {
  role: RenpyButtonRole;
  geometry: Required<RenpyButtonRoleGeometry>;
  /** Flow controls can grow from the default minimum, but authored axes stay fixed. */
  sizing: Record<"width" | "height", "fixed" | "content">;
  states: Record<RenpyButtonState, RenpyButtonRoleStateStyle & {
    geometry: Required<RenpyButtonRoleGeometry>;
  }>;
}
export type RenpyButtonRoleMap = Partial<Record<RenpyButtonRole, RenpyButtonRoleStyle>>;
export type RenpyGUIPageStyle = Partial<RenpyGUIStyle> & {
  buttonImages?: RenpyButtonStateImages;
  buttonTextColors?: RenpyButtonStateColors;
  buttonBorders?: RenpyButtonBorders;
  buttonTile?: boolean;
  buttonRoles?: RenpyButtonRoleMap;
};
export const RENPY_NAVIGATION_PAGES = ["title", "preferences", "save_load", "history", "about", "help", "gallery"] as const;
export type RenpyNavigationPage = typeof RENPY_NAVIGATION_PAGES[number];
export const RENPY_BUTTON_ROLE_PAGES = [...RENPY_NAVIGATION_PAGES, "player", "confirmation"] as const;
export type RenpyButtonRolePage = typeof RENPY_BUTTON_ROLE_PAGES[number];
export type RenpyGUI = Partial<Record<"shared" | RenpyButtonRolePage, RenpyGUIPageStyle>>;
export const RENPY_BUTTON_STATES: readonly RenpyButtonState[] = ["normal", "hover", "selected", "disabled"];
export const RENPY_NAVIGATION_DEFAULTS: RenpyNavigationStyle = { x: 40, fontSize: 22, spacing: 4 };
export const RENPY_NAVIGATION_LIMITS = { x: [0, 400], fontSize: [12, 48], spacing: [0, 32] } as const;
export const RENPY_SAVE_GRID_DEFAULTS: RenpySaveGridStyle = { saveColumns: 3, saveGap: 14 };
export const RENPY_SAVE_GRID_LIMITS = { saveColumns: [1, 6], saveGap: [0, 40] } as const;
export const RENPY_MENU_FRAME_DEFAULTS: RenpyMenuFrameStyle = {
  menuNavigationWidth: 280, menuTopPadding: 120, menuBottomPadding: 30,
  menuContentLeft: 40, menuContentRight: 20, menuContentTop: 10,
  menuTitleX: 50, menuTitleFontSize: 50,
};
export const RENPY_MENU_FRAME_PROPERTIES = [
  ["menuNavigationWidth", "导航区宽度"],
  ["menuTopPadding", "标题区高度"],
  ["menuBottomPadding", "底部留白"],
  ["menuContentLeft", "内容左边距"],
  ["menuContentRight", "内容右边距"],
  ["menuContentTop", "内容顶部间距"],
  ["menuTitleX", "标题左边距"],
  ["menuTitleFontSize", "标题字号"],
] as const;
export const RENPY_MENU_FRAME_LIMITS = {
  menuNavigationWidth: [160, 600], menuTopPadding: [80, 220], menuBottomPadding: [16, 100],
  menuContentLeft: [0, 100], menuContentRight: [0, 100], menuContentTop: [0, 60],
  menuTitleX: [0, 400], menuTitleFontSize: [20, 80],
} as const;
export const RENPY_BUTTON_BORDER_LIMITS = { min: 0, max: 512 } as const;
export const RENPY_BUTTON_ROLE_GEOMETRY_DEFAULTS: Record<RenpyButtonRole, Required<RenpyButtonRoleGeometry>> = {
  title_action: { width: 240, height: 48, paddingX: 18, paddingY: 10, fontSize: 22 },
  page_navigation: { width: 176, height: 42, paddingX: 14, paddingY: 8, fontSize: 20 },
  category_pagination: { width: 136, height: 40, paddingX: 12, paddingY: 8, fontSize: 18 },
  story_choice: { width: 320, height: 58, paddingX: 20, paddingY: 12, fontSize: 22 },
  quick_bar: { width: 104, height: 42, paddingX: 12, paddingY: 8, fontSize: 16 },
  modal_action: { width: 144, height: 44, paddingX: 16, paddingY: 8, fontSize: 18 },
};
export const RENPY_GUI_DEFAULTS: RenpyGUIStyle = {
  ...RENPY_NAVIGATION_DEFAULTS, ...RENPY_SAVE_GRID_DEFAULTS, ...RENPY_MENU_FRAME_DEFAULTS,
};
export const RENPY_GUI_LIMITS = {
  ...RENPY_NAVIGATION_LIMITS, ...RENPY_SAVE_GRID_LIMITS, ...RENPY_MENU_FRAME_LIMITS,
} as const;

const RENPY_BUTTON_GEOMETRY_LIMITS: Record<keyof RenpyButtonRoleGeometry, readonly [number, number]> = {
  width: [1, 2048],
  height: [1, 1024],
  paddingX: [0, 256],
  paddingY: [0, 256],
  fontSize: [8, 128],
};
const RENPY_BUTTON_STYLE_KEYS = ["textColor", "backgroundColor", "borderColor", "borderWidth", "opacity"] as const;
const RENPY_BUTTON_COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/;

/**
 * Resolves one button role without mutating the saved GUI. Page values override
 * shared role values; legacy shared text colors remain the compatibility base.
 * All states receive one max-size width/height envelope to prevent layout shift.
 */
export function resolveRenpyButtonRole(
  gui: RenpyGUI | undefined,
  role: RenpyButtonRole,
  page: RenpyButtonRolePage = "title",
): ResolvedRenpyButtonRole {
  const defaults = RENPY_BUTTON_ROLE_GEOMETRY_DEFAULTS[role];
  const sharedRole = gui?.shared?.buttonRoles?.[role];
  const pageRole = gui?.[page]?.buttonRoles?.[role];
  const baseGeometry = mergeButtonGeometry(defaults, sharedRole?.geometry, pageRole?.geometry);
  const perState = Object.fromEntries(RENPY_BUTTON_STATES.map((state) => {
    const sharedState = sharedRole?.states?.[state];
    const pageState = pageRole?.states?.[state];
    const geometry = mergeButtonGeometry(
      baseGeometry,
      sharedState?.geometry,
      pageState?.geometry,
    );
    const style: RenpyButtonRoleStateStyle = {
      ...(gui?.shared?.buttonTextColors?.[state] ? { textColor: gui.shared.buttonTextColors[state] } : {}),
      ...pickButtonStateStyle(sharedState),
      ...pickButtonStateStyle(pageState),
    };
    return [state, { geometry, style }];
  })) as Record<RenpyButtonState, { geometry: Required<RenpyButtonRoleGeometry>; style: RenpyButtonRoleStateStyle }>;
  const envelope = {
    width: Math.max(...RENPY_BUTTON_STATES.map((state) => perState[state].geometry.width)),
    height: Math.max(...RENPY_BUTTON_STATES.map((state) => perState[state].geometry.height)),
  };
  const geometry = { ...baseGeometry, ...envelope };
  const states = Object.fromEntries(RENPY_BUTTON_STATES.map((state) => [state, {
    ...perState[state].style,
    geometry: { ...perState[state].geometry, ...envelope },
  }])) as ResolvedRenpyButtonRole["states"];
  // Navigation and modal actions are content-flow controls. Changing only a
  // color/font must not silently turn the default minimum into a clipping box.
  // Keep solver-owned title/choice/category/quick-bar geometry unchanged.
  const contentFlow = role === "page_navigation" || role === "modal_action";
  const explicitAxis = (axis: "width" | "height") => [sharedRole, pageRole].some(config =>
    config?.geometry?.[axis] !== undefined || RENPY_BUTTON_STATES.some(state =>
      config?.states?.[state]?.geometry?.[axis] !== undefined));
  const sizing: ResolvedRenpyButtonRole["sizing"] = {
    width: contentFlow && !explicitAxis("width") ? "content" : "fixed",
    height: contentFlow && !explicitAxis("height") ? "content" : "fixed",
  };
  return { role, geometry, sizing, states };
}

function mergeButtonGeometry(
  ...sources: Array<Partial<RenpyButtonRoleGeometry> | undefined>
): Required<RenpyButtonRoleGeometry> {
  const merged = Object.assign({}, ...sources.filter(Boolean)) as RenpyButtonRoleGeometry;
  const defaults = RENPY_BUTTON_ROLE_GEOMETRY_DEFAULTS.title_action;
  return {
    width: merged.width ?? defaults.width,
    height: merged.height ?? defaults.height,
    paddingX: merged.paddingX ?? defaults.paddingX,
    paddingY: merged.paddingY ?? defaults.paddingY,
    fontSize: merged.fontSize ?? defaults.fontSize,
  };
}

function pickButtonStateStyle(value: RenpyButtonRoleState | undefined): RenpyButtonRoleStateStyle {
  if (!value) return {};
  return Object.fromEntries(RENPY_BUTTON_STYLE_KEYS.flatMap((key) =>
    value[key] === undefined ? [] : [[key, value[key]]])) as RenpyButtonRoleStateStyle;
}

export type RenpyGUIImportIssueCode = "unsupported_parameter" | "unsupported_expression" | "unsupported_context";
export interface RenpyGUIImportIssue {
  code: RenpyGUIImportIssueCode;
  parameter: string;
  line: number;
  expression: string;
  message: string;
}
export interface RenpyGUIParameterImport {
  values: RenpyGUI;
  issues: RenpyGUIImportIssue[];
  complete: boolean;
}

type RenpyGUIParameterMapping =
  | { kind: "number"; key: keyof RenpyGUIStyle; scope: "shared" | "save_load" }
  | { kind: "button_text_color"; state: RenpyButtonState; scope: "shared" }
  | { kind: "button_borders"; scope: "shared" }
  | { kind: "button_tile"; scope: "shared" };

const renpyGUIParameterMap: Readonly<Record<string, RenpyGUIParameterMapping>> = {
  interface_text_size: { kind: "number", key: "fontSize", scope: "shared" },
  navigation_font_size: { kind: "number", key: "fontSize", scope: "shared" },
  navigation_xpos: { kind: "number", key: "x", scope: "shared" },
  navigation_spacing: { kind: "number", key: "spacing", scope: "shared" },
  file_slot_cols: { kind: "number", key: "saveColumns", scope: "save_load" },
  slot_spacing: { kind: "number", key: "saveGap", scope: "save_load" },
  button_borders: { kind: "button_borders", scope: "shared" },
  button_tile: { kind: "button_tile", scope: "shared" },
  idle_color: { kind: "button_text_color", state: "normal", scope: "shared" },
  hover_color: { kind: "button_text_color", state: "hover", scope: "shared" },
  selected_color: { kind: "button_text_color", state: "selected", scope: "shared" },
  insensitive_color: { kind: "button_text_color", state: "disabled", scope: "shared" },
  button_text_idle_color: { kind: "button_text_color", state: "normal", scope: "shared" },
  button_text_hover_color: { kind: "button_text_color", state: "hover", scope: "shared" },
  button_text_selected_color: { kind: "button_text_color", state: "selected", scope: "shared" },
  button_text_insensitive_color: { kind: "button_text_color", state: "disabled", scope: "shared" },
};

/**
 * Reads only a small, explicit subset of static gui.rpy assignments.
 * It never evaluates Python. Unknown parameters and expressions are returned
 * as visible issues so callers cannot present a partial import as complete.
 */
export function parseRenpyGUIParameters(source: string): RenpyGUIParameterImport {
  const values: RenpyGUI = {};
  const issues: RenpyGUIImportIssue[] = [];
  const resolvedNumbers = new Map<string, number>();
  const resolvedColors = new Map<string, string>();
  const lexicalState: { multiline?: '"""' | "'''" } = {};
  // This is a static importer, not a Python interpreter. Only top-level
  // assignments and direct statements in a plain global init-python block
  // have known ownership. Never flatten functions, variants or conditions.
  const blocks: Array<{ indent: number; header: string; staticInit: boolean; bodyIndent?: number }> = [];
  for (const [index, originalLine] of source.split(/\r?\n/).entries()) {
    const content = stripRenpyComment(originalLine, lexicalState);
    const line = content.trim();
    if (!line) continue;
    const indent = [...(/^[ \t]*/.exec(content)?.[0] ?? "")].reduce(
      (column, character) => character === "\t" ? column + 8 - column % 8 : column + 1, 0,
    );
    while (blocks.length && indent <= blocks[blocks.length - 1].indent) blocks.pop();
    const parent = blocks[blocks.length - 1];
    if (parent && parent.bodyIndent === undefined) parent.bodyIndent = indent;
    const staticContext = indent === 0 || (blocks.length === 1 && parent.staticInit && indent === parent.bodyIndent);
    if (line.endsWith(":")) {
      blocks.push({
        indent,
        header: line,
        staticInit: indent === 0 && /^init(?:\s+[+-]?\d+)?\s+python\s*:$/.test(line),
      });
    }
    const assignment = /^(?:define\s+)?gui\.([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!assignment) continue;
    const [, parameterName, expression] = assignment;
    const parameter = `gui.${parameterName}`;
    if (!staticContext) {
      issues.push({
        code: "unsupported_context",
        parameter,
        line: index + 1,
        expression,
        message: `参数 ${parameter} 位于未导入的上下文（${blocks.map((block) => block.header).join(" → ") || "非顶层缩进"}）。`
          + "只读取顶层或全局 init python 的直接静态赋值；不执行条件、函数、移动变体或屏幕逻辑。",
      });
      continue;
    }
    const mapping = renpyGUIParameterMap[parameterName];
    if (!mapping) {
      issues.push({
        code: "unsupported_parameter",
        parameter,
        line: index + 1,
        expression,
        message: `参数 ${parameter} 尚未映射到 AgentVN 布局。`,
      });
      continue;
    }
    if (mapping.kind === "button_borders") {
      const borders = parseRenpyBordersExpression(expression, resolvedNumbers);
      if (!borders || Object.values(borders).some((value) =>
        value < RENPY_BUTTON_BORDER_LIMITS.min || value > RENPY_BUTTON_BORDER_LIMITS.max)) {
        issues.push({
          code: "unsupported_expression",
          parameter,
          line: index + 1,
          expression,
          message: `参数 ${parameter} 必须是四个 0–${RENPY_BUTTON_BORDER_LIMITS.max} 范围内的静态边界值，未执行其内容。`,
        });
        continue;
      }
      const target = values.shared ?? (values.shared = {});
      target.buttonBorders = borders;
      continue;
    }
    if (mapping.kind === "button_tile") {
      if (expression !== "True" && expression !== "False") {
        issues.push({
          code: "unsupported_expression",
          parameter,
          line: index + 1,
          expression,
          message: `参数 ${parameter} 只接受静态 True 或 False，未执行其内容。`,
        });
        continue;
      }
      const target = values.shared ?? (values.shared = {});
      target.buttonTile = expression === "True";
      continue;
    }
    if (mapping.kind === "button_text_color") {
      const color = parseRenpyColorExpression(expression, resolvedColors);
      if (color === undefined) {
        issues.push({
          code: "unsupported_expression",
          parameter,
          line: index + 1,
          expression,
          message: `参数 ${parameter} 不是受支持的静态颜色或已定义 gui.* 颜色引用，未执行其内容。`,
        });
        continue;
      }
      resolvedColors.set(parameterName, color);
      const target = values.shared ?? (values.shared = {});
      target.buttonTextColors = { ...target.buttonTextColors, [mapping.state]: color };
      continue;
    }
    const value = parseRenpyNumericExpression(expression, resolvedNumbers);
    if (value === undefined || !Number.isFinite(value)) {
      issues.push({
        code: "unsupported_expression",
        parameter,
        line: index + 1,
        expression,
        message: `参数 ${parameter} 不是受支持的静态数值表达式，未执行其内容。`,
      });
      continue;
    }
    resolvedNumbers.set(parameterName, value);
    const target = values[mapping.scope] ?? (values[mapping.scope] = {});
    (target as Record<string, number>)[mapping.key] = value;
  }
  return { values, issues, complete: issues.length === 0 };
}

function parseRenpyBordersExpression(
  expression: string,
  references: ReadonlyMap<string, number>,
): RenpyButtonBorders | undefined {
  const match = /^Borders\((.*)\)$/.exec(expression.trim());
  if (!match) return undefined;
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < match[1].length; index += 1) {
    const char = match[1][index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < 0) return undefined;
    } else if (char === "," && depth === 0) {
      parts.push(match[1].slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) return undefined;
  parts.push(match[1].slice(start).trim());
  if (parts.length !== 4 || parts.some((part) => !part)) return undefined;
  const values = parts.map((part) => parseRenpyNumericExpression(part, references));
  if (values.some((value) => value === undefined || !Number.isFinite(value))) return undefined;
  const [left, top, right, bottom] = values as [number, number, number, number];
  return { left, top, right, bottom };
}

function parseRenpyColorExpression(expression: string, references: ReadonlyMap<string, string>): string | undefined {
  const value = expression.trim();
  const literal = /^(["'])(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)\1$/.exec(value);
  if (literal) return literal[2];
  const reference = /^gui\.([A-Za-z_]\w*)$/.exec(value);
  return reference ? references.get(reference[1]) : undefined;
}

function stripRenpyComment(value: string, state: { multiline?: '"""' | "'''" }): string {
  let output = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let index = 0;
  while (index < value.length) {
    if (state.multiline) {
      const close = value.indexOf(state.multiline, index);
      if (close < 0) return output;
      output += " ".repeat(close + state.multiline.length - index);
      index = close + state.multiline.length;
      state.multiline = undefined;
      continue;
    }
    const char = value[index];
    if (escaped) {
      escaped = false;
      output += char;
      index += 1;
      continue;
    }
    if (char === "\\" && quote) {
      escaped = true;
      output += char;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      output += char;
      index += 1;
      continue;
    }
    const triple = value.slice(index, index + 3);
    if (triple === '"""' || triple === "'''") {
      state.multiline = triple;
      output += "   ";
      index += 3;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (char === "#") return output;
    output += char;
    index += 1;
  }
  return output;
}

function parseRenpyNumericExpression(expression: string, references: ReadonlyMap<string, number>): number | undefined {
  const tokens = expression.match(/gui\.[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]/g) ?? [];
  if (!tokens.length || tokens.join("").replace(/\s/g, "") !== expression.replace(/\s/g, "")) return undefined;
  let cursor = 0;
  const parsePrimary = (): number | undefined => {
    const token = tokens[cursor++];
    if (token === "(") {
      const value = parseSum();
      if (tokens[cursor++] !== ")") return undefined;
      return value;
    }
    if (token === "+" || token === "-") {
      const value = parsePrimary();
      return value === undefined ? undefined : token === "-" ? -value : value;
    }
    if (!token) return undefined;
    if (token.startsWith("gui.")) return references.get(token.slice(4));
    const number = Number(token);
    return Number.isFinite(number) ? number : undefined;
  };
  const parseProduct = (): number | undefined => {
    let value = parsePrimary();
    while (value !== undefined && (tokens[cursor] === "*" || tokens[cursor] === "/")) {
      const operator = tokens[cursor++];
      const right = parsePrimary();
      if (right === undefined || (operator === "/" && right === 0)) return undefined;
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const parseSum = (): number | undefined => {
    let value = parseProduct();
    while (value !== undefined && (tokens[cursor] === "+" || tokens[cursor] === "-")) {
      const operator = tokens[cursor++];
      const right = parseProduct();
      if (right === undefined) return undefined;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const result = parseSum();
  return cursor === tokens.length ? result : undefined;
}

export function resolveRenpyNavigation(gui?: RenpyGUI, page: RenpyNavigationPage = "title"): RenpyNavigationStyle {
  const result = { ...RENPY_NAVIGATION_DEFAULTS };
  for (const key of Object.keys(result) as Array<keyof RenpyNavigationStyle>) {
    const value = gui?.[page]?.[key] ?? gui?.shared?.[key] ?? result[key];
    const [min, max] = RENPY_NAVIGATION_LIMITS[key];
    result[key] = typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : result[key];
  }
  return result;
}

export function resolveRenpySaveGrid(gui?: RenpyGUI, baseline?: Partial<RenpySaveGridStyle>): RenpySaveGridStyle {
  const shared = gui?.shared;
  const page = gui?.save_load;
  // Legacy component values remain the inherited baseline, not a second writable GUI.
  const columns = typeof baseline?.saveColumns === "number" && Number.isFinite(baseline.saveColumns)
    ? Math.max(1, Math.round(baseline.saveColumns)) : RENPY_SAVE_GRID_DEFAULTS.saveColumns;
  const gap = typeof baseline?.saveGap === "number" && Number.isFinite(baseline.saveGap) && baseline.saveGap >= 0
    ? baseline.saveGap : RENPY_SAVE_GRID_DEFAULTS.saveGap;
  return {
    saveColumns: Math.round(resolveBoundedNumber(page?.saveColumns ?? shared?.saveColumns,
      columns, RENPY_SAVE_GRID_LIMITS.saveColumns)),
    saveGap: resolveBoundedNumber(page?.saveGap ?? shared?.saveGap,
      gap, RENPY_SAVE_GRID_LIMITS.saveGap),
  };
}

export function resolveRenpyMenuFrame(gui: RenpyGUI | undefined, page: Exclude<RenpyNavigationPage, "title">): RenpyMenuFrameStyle {
  const result = { ...RENPY_MENU_FRAME_DEFAULTS };
  for (const [key] of RENPY_MENU_FRAME_PROPERTIES) {
    result[key] = resolveBoundedNumber(gui?.[page]?.[key] ?? gui?.shared?.[key],
      result[key], RENPY_MENU_FRAME_LIMITS[key]);
  }
  return result;
}

function resolveBoundedNumber(value: unknown, fallback: number, limits: readonly [number, number]): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(limits[0], Math.min(limits[1], value))
    : fallback;
}

export function renpyGUIErrors(value: unknown): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["renpy"];
  const errors: string[] = [];
  for (const [scope, fields] of Object.entries(value)) {
    if (!["shared", ...RENPY_BUTTON_ROLE_PAGES].includes(scope) || !fields || typeof fields !== "object" || Array.isArray(fields)) {
      errors.push(`renpy.${scope}`); continue;
    }
    for (const [key, v] of Object.entries(fields)) {
      if (key === "buttonImages") {
        if (scope !== "shared" || !v || typeof v !== "object" || Array.isArray(v)) {
          errors.push(`renpy.${scope}.buttonImages`);
          continue;
        }
        for (const [state, reference] of Object.entries(v)) {
          if (!["normal", "hover", "selected", "disabled"].includes(state)
            || typeof reference !== "string"
            || !isUILayoutAssetReference(reference)) {
            errors.push(`renpy.${scope}.buttonImages.${state}`);
          }
        }
        continue;
      }
      if (key === "buttonBorders") {
        const expectedKeys = ["bottom", "left", "right", "top"];
        if (scope !== "shared" || !v || typeof v !== "object" || Array.isArray(v)
          || Object.keys(v).sort().join(",") !== expectedKeys.join(",")) {
          errors.push(`renpy.${scope}.buttonBorders`);
          continue;
        }
        for (const [edge, width] of Object.entries(v)) {
          if (typeof width !== "number" || !Number.isFinite(width)
            || width < RENPY_BUTTON_BORDER_LIMITS.min || width > RENPY_BUTTON_BORDER_LIMITS.max) {
            errors.push(`renpy.${scope}.buttonBorders.${edge}`);
          }
        }
        continue;
      }
      if (key === "buttonTile") {
        if (scope !== "shared" || typeof v !== "boolean") errors.push(`renpy.${scope}.buttonTile`);
        continue;
      }
      if (key === "buttonTextColors") {
        if (scope !== "shared" || !v || typeof v !== "object" || Array.isArray(v)) {
          errors.push(`renpy.${scope}.buttonTextColors`);
          continue;
        }
        for (const [state, color] of Object.entries(v)) {
          if (!["normal", "hover", "selected", "disabled"].includes(state)
            || typeof color !== "string"
            || !/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/.test(color)) {
            errors.push(`renpy.${scope}.buttonTextColors.${state}`);
          }
        }
        continue;
      }
      if (key === "buttonRoles") {
        if (!v || typeof v !== "object" || Array.isArray(v)) {
          errors.push(`renpy.${scope}.buttonRoles`);
          continue;
        }
        for (const [role, config] of Object.entries(v)) {
          const rolePath = `renpy.${scope}.buttonRoles.${role}`;
          if (!RENPY_BUTTON_ROLES.includes(role as RenpyButtonRole)
            || !config || typeof config !== "object" || Array.isArray(config)) {
            errors.push(rolePath);
            continue;
          }
          const roleConfig = config as Record<string, unknown>;
          for (const configKey of Object.keys(roleConfig)) {
            if (configKey !== "geometry" && configKey !== "states") errors.push(`${rolePath}.${configKey}`);
          }
          if (roleConfig.geometry !== undefined) {
            errors.push(...renpyButtonGeometryErrors(roleConfig.geometry, `${rolePath}.geometry`));
          }
          if (roleConfig.states !== undefined) {
            if (!roleConfig.states || typeof roleConfig.states !== "object" || Array.isArray(roleConfig.states)) {
              errors.push(`${rolePath}.states`);
            } else {
              for (const [state, stateConfig] of Object.entries(roleConfig.states)) {
                const statePath = `${rolePath}.states.${state}`;
                if (!RENPY_BUTTON_STATES.includes(state as RenpyButtonState)
                  || !stateConfig || typeof stateConfig !== "object" || Array.isArray(stateConfig)) {
                  errors.push(statePath);
                  continue;
                }
                const stateValues = stateConfig as Record<string, unknown>;
                for (const stateKey of Object.keys(stateValues)) {
                  if (stateKey === "geometry") continue;
                  if (!RENPY_BUTTON_STYLE_KEYS.includes(stateKey as typeof RENPY_BUTTON_STYLE_KEYS[number])) {
                    errors.push(`${statePath}.${stateKey}`);
                    continue;
                  }
                  const value = stateValues[stateKey];
                  if ((stateKey === "textColor" || stateKey === "backgroundColor" || stateKey === "borderColor")
                    && (typeof value !== "string" || !RENPY_BUTTON_COLOR_PATTERN.test(value))) {
                    errors.push(`${statePath}.${stateKey}`);
                  } else if (stateKey === "borderWidth"
                    && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 32)) {
                    errors.push(`${statePath}.${stateKey}`);
                  } else if (stateKey === "opacity"
                    && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
                    errors.push(`${statePath}.${stateKey}`);
                  }
                }
                if (stateValues.geometry !== undefined) {
                  errors.push(...renpyButtonGeometryErrors(stateValues.geometry, `${statePath}.geometry`));
                }
              }
            }
          }
        }
        continue;
      }
      const limits = Object.prototype.hasOwnProperty.call(RENPY_NAVIGATION_LIMITS, key)
        ? RENPY_NAVIGATION_LIMITS[key as keyof RenpyNavigationStyle]
        : Object.prototype.hasOwnProperty.call(RENPY_SAVE_GRID_LIMITS, key)
          ? RENPY_SAVE_GRID_LIMITS[key as keyof RenpySaveGridStyle]
          : Object.prototype.hasOwnProperty.call(RENPY_MENU_FRAME_LIMITS, key)
            && scope !== "title" && scope !== "player"
            ? RENPY_MENU_FRAME_LIMITS[key as keyof RenpyMenuFrameStyle]
            : undefined;
      if (!limits
        || typeof v !== "number" || !Number.isFinite(v) || v < limits[0] || v > limits[1]
        || ((key === "saveColumns" || key === "saveGap") && scope !== "shared" && scope !== "save_load")
        || (key === "saveColumns" && !Number.isInteger(v)))
        errors.push(`renpy.${scope}.${key}`);
    }
  }
  return errors;
}

function renpyButtonGeometryErrors(value: unknown, path: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [path];
  const errors: string[] = [];
  for (const [key, number] of Object.entries(value)) {
    const limits = RENPY_BUTTON_GEOMETRY_LIMITS[key as keyof RenpyButtonRoleGeometry];
    if (!limits || typeof number !== "number" || !Number.isFinite(number)
      || number < limits[0] || number > limits[1]) {
      errors.push(`${path}.${key}`);
    }
  }
  return errors;
}
