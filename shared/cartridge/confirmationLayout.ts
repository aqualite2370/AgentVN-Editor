import type { UILayoutComponentStyle, UILayoutRect, UISkinLayout } from "./uiSkin";
import type { ControlPresentationSource } from "./controlPresentation";

/** Visual authoring only. Confirmation actions, wording and save safety stay in Runtime. */
export interface ConfirmationLayout {
  rect?: UILayoutRect;
  panelStyle?: UILayoutComponentStyle;
  titleStyle?: UILayoutComponentStyle;
  textStyle?: UILayoutComponentStyle;
  panelPresentation?: ControlPresentationSource;
  titlePresentation?: ControlPresentationSource;
  textPresentation?: ControlPresentationSource;
}

export const CONFIRMATION_AUTHOR_RECT: UILayoutRect = {
  x: 27, y: 30, width: 46, height: 40, anchor: "top_left",
};

export function confirmationStyleGroups(layout: UISkinLayout): UILayoutComponentStyle[] {
  const config = layout.confirmationLayout;
  return [config?.panelStyle, config?.titleStyle, config?.textStyle]
    .filter((style): style is UILayoutComponentStyle => Boolean(style));
}

export function updateConfirmationLayout(layout: UISkinLayout, value?: ConfirmationLayout): UISkinLayout {
  const next = structuredClone(layout);
  if (value && Object.keys(value).length) next.confirmationLayout = structuredClone(value);
  else delete next.confirmationLayout;
  return next;
}

/** Reserve enough panel space for real controls; never rewrites imported data. */
export function constrainConfirmationRect(rect: UILayoutRect): UILayoutRect {
  const width = Math.max(25, Math.min(96, rect.width));
  const height = Math.max(25, Math.min(90, rect.height));
  return { x: Math.max(2, Math.min(98 - width, rect.x)),
    y: Math.max(2, Math.min(98 - height, rect.y)), width, height, anchor: "top_left" };
}
