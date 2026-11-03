import type { UILayoutComponent, UISkinLayout } from "./uiSkin";

export interface RenpyTitleTextItem {
  visible?: boolean;
  /** Absent inherits the project value. An explicit empty string stays empty. */
  text?: string;
}
export interface RenpyTitleText {
  title?: RenpyTitleTextItem;
  version?: RenpyTitleTextItem;
}
export const RENPY_TITLE_TEXT_MAX_LENGTH = 160;

export interface TitleNavigationRect { x: number; y: number; width: number; height: number }

/** Reserve author-owned title components without rewriting their saved geometry.
 * Both the editor's logical preview and Runtime use these same frame coordinates. */
export function renpyTitleObstacles(
  components: UILayoutComponent[], width: number, height: number,
): TitleNavigationRect[] {
  return components.filter(component => component.component_type === "custom_component"
    && component.visible !== false && component.rect).map(component => {
    const rect = component.rect!;
    const w = rect.width * width / 100, h = rect.height * height / 100;
    const ax = ["top_center", "bottom_center", "center"].includes(rect.anchor ?? "") ? 0.5
      : ["top_right", "bottom_right"].includes(rect.anchor ?? "") ? 1 : 0;
    const ay = ["bottom_left", "bottom_center", "bottom_right"].includes(rect.anchor ?? "") ? 1
      : rect.anchor === "center" ? 0.5 : 0;
    return { x: rect.x * width / 100 - ax * w, y: rect.y * height / 100 - ay * h, width: w, height: h };
  });
}

/** Prefer the configured navigation position; move only when authored content
 * intersects it. Search obstacle edges, preserving the left rail when possible.
 * Impossible authored compositions are reported rather than shrinking text. */
export function placeRenpyTitleNavigation(
  preferred: TitleNavigationRect, obstacles: TitleNavigationRect[],
  width: number, height: number, gap: number,
): { rect: TitleNavigationRect; clear: boolean } {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  const area = (a: TitleNavigationRect, b: TitleNavigationRect) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width + gap) - Math.max(a.x, b.x - gap))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height + gap) - Math.max(a.y, b.y - gap));
  const xs = [preferred.x, 0, width - preferred.width,
    ...obstacles.flatMap(r => [r.x - preferred.width - gap, r.x + r.width + gap])];
  const ys = [preferred.y, 0, height - preferred.height,
    ...obstacles.flatMap(r => [r.y - preferred.height - gap, r.y + r.height + gap])];
  let best = { ...preferred }, cost = Infinity, collision = Infinity;
  for (const x of xs) for (const y of ys) {
    const rect = { ...preferred, x: clamp(x, width - preferred.width), y: clamp(y, height - preferred.height) };
    const overlap = obstacles.reduce((sum, obstacle) => sum + area(rect, obstacle), 0);
    const distance = 4 * Math.abs(rect.x - preferred.x) + Math.abs(rect.y - preferred.y);
    if (overlap < collision - 0.001 || Math.abs(overlap - collision) < 0.001 && distance < cost) {
      best = rect; collision = overlap; cost = distance;
    }
  }
  return { rect: best, clear: collision < 0.001 && best.width <= width && best.height <= height };
}

export function resolveRenpyTitleActionLabel(component: UILayoutComponent | undefined, fallback: string): string {
  const text = component?.label?.trim();
  // These two authorable identities were introduced with editor-facing labels.
  if (!text || component?.component_id === "title_help_button" && text === "帮助按钮"
    || component?.component_id === "title_exit_button" && text === "退出按钮") return fallback;
  return text;
}

export function resolveRenpyTitleText(config: RenpyTitleText | undefined, title: string, version?: string) {
  const resolve = (item: RenpyTitleTextItem | undefined, inherited: string | undefined) =>
    item?.visible === false ? undefined : item?.text ?? inherited;
  return { title: resolve(config?.title, title), version: resolve(config?.version, version) };
}

export function renpyTitleTextErrors(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [""];
  const errors: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!["title", "version"].includes(key) || !item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(key); continue;
    }
    for (const [field, v] of Object.entries(item)) {
      if (field === "visible" ? typeof v !== "boolean"
        : field === "text" ? typeof v !== "string" || v.length > RENPY_TITLE_TEXT_MAX_LENGTH : true)
        errors.push(`${key}.${field}`);
    }
  }
  return errors;
}

/** Fixed native actions still need authorable identities; do not turn them
 * into custom action buttons or replace any existing author's data. */
export function ensureRenpyTitleControls(layout: UISkinLayout): UISkinLayout {
  if (layout.layout_type !== "renpy") return layout;
  const defaults: UILayoutComponent[] = [
    { component_id: "title_help_button", component_type: "menu_button", label: "帮助按钮",
      rect: { x: 5, y: 77, width: 24, height: 5 } },
    { component_id: "title_exit_button", component_type: "main_menu_exit_button", label: "退出按钮",
      rect: { x: 5, y: 84, width: 24, height: 5 } },
  ];
  return { ...layout, screens: layout.screens.map(screen => screen.screen_id !== "title" ? screen : {
    ...screen, components: [...screen.components, ...defaults.filter(control =>
      !screen.components.some(existing => existing.component_id === control.component_id))],
  }) };
}
