import type { UILayoutComponentStyle, UILayoutRect, UISkinLayout } from "./uiSkin";
import type { ControlPresentationSource } from "./controlPresentation";

export type DialogueLayoutMode = "dialog" | "nvl" | "bubble";
export type DialogueModeLayout = {
  rect?: UILayoutRect;
  panelStyle?: UILayoutComponentStyle;
  textStyle?: UILayoutComponentStyle;
  speakerStyle?: UILayoutComponentStyle;
  panelPresentation?: ControlPresentationSource;
  textPresentation?: ControlPresentationSource;
  speakerPresentation?: ControlPresentationSource;
};
export type DialogueModeLayouts = Partial<Record<"nvl" | "bubble", DialogueModeLayout>>;

export const DIALOGUE_LAYOUT_MODES = [
  { value: "dialog", label: "普通对白" },
  { value: "nvl", label: "NVL 累积阅读" },
  { value: "bubble", label: "气泡对白" },
] as const;

export function dialogueModeStyleGroups(layout: UISkinLayout): UILayoutComponentStyle[] {
  return Object.values(layout.dialogueLayouts ?? {}).flatMap(mode =>
    [mode.panelStyle, mode.textStyle, mode.speakerStyle].filter(
      (style): style is UILayoutComponentStyle => Boolean(style),
    ));
}

const defaultRects: Record<"nvl" | "bubble", UILayoutRect> = {
  nvl: { x: 5, y: 18, width: 90, height: 70, anchor: "top_left" },
  bubble: { x: 50, y: 18, width: 42, height: 28, anchor: "center" },
};

/** Author-input bounds; does not normalize or rewrite imported layouts. */
export function constrainDialogueLayoutRect(rect: UILayoutRect): UILayoutRect {
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.round(Math.max(minimum, Math.min(maximum, value)) * 100) / 100;
  const width = clamp(rect.width, 1, 100), height = clamp(rect.height, 1, 100);
  const anchor = rect.anchor ?? "top_left";
  const xFactor = anchor === "center" || anchor.endsWith("_center") ? .5
    : anchor.endsWith("_right") ? 1 : 0;
  const yFactor = anchor === "center" ? .5 : anchor.startsWith("bottom_") ? 1 : 0;
  return {
    ...rect, width, height,
    x: clamp(rect.x, width * xFactor, 100 - width * (1 - xFactor)),
    y: clamp(rect.y, height * yFactor, 100 - height * (1 - yFactor)),
  };
}

/** Read-through inheritance only; inspecting a mode never migrates user data. */
export function resolveDialogueModeLayout(layout: UISkinLayout, mode: "nvl" | "bubble") {
  const components = layout.screens.find(screen => screen.screen_id === "player")?.components ?? [];
  const override = layout.dialogueLayouts?.[mode];
  const sharedStyle = (type: string) => components.find(component => component.component_type === type)?.style ?? {};
  return {
    overridden: Boolean(override && Object.keys(override).length),
    rect: structuredClone(override?.rect ?? defaultRects[mode]),
    panelStyle: { ...sharedStyle("dialog_panel"), ...override?.panelStyle },
    textStyle: { ...sharedStyle("dialog_text"), ...override?.textStyle },
    speakerStyle: { ...sharedStyle("speaker_label"), ...override?.speakerStyle },
  };
}

/** One undoable author edit; never rewrites another mode or the shared screens. */
export function updateDialogueModeLayout(
  layout: UISkinLayout, mode: "nvl" | "bubble", value: DialogueModeLayout | undefined,
): UISkinLayout {
  const next = structuredClone(layout);
  const layouts = { ...next.dialogueLayouts };
  if (value && Object.keys(value).length) layouts[mode] = structuredClone(value);
  else delete layouts[mode];
  if (Object.keys(layouts).length) next.dialogueLayouts = layouts;
  else delete next.dialogueLayouts;
  return next;
}
