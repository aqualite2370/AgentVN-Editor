import type { RuntimeLayoutType } from "../../../shared/cartridge/uiLayoutProfiles";
import type { UILayoutScreenId } from "../../../shared/cartridge/uiSkin";

export interface LayoutHelpSelection {
  layoutType: RuntimeLayoutType;
  screenId: UILayoutScreenId;
  componentId?: string;
  advanced: boolean;
}
let lastSelection: { projectId: string; selection: LayoutHelpSelection } | undefined;

/** Only authored control identity, never code, story, asset bytes, paths or keys.
 * Kept in memory when navigating to inquiry; a different project cannot read it. */
export function recordLayoutHelpSelection(projectId: string, selection: LayoutHelpSelection) {
  lastSelection = { projectId, selection: {
    layoutType: selection.layoutType, screenId: selection.screenId,
    componentId: selection.componentId, advanced: selection.advanced,
  } };
}
export function readLayoutHelpContext(projectId: string, activeType: RuntimeLayoutType): string {
  const selection = lastSelection?.projectId === projectId && lastSelection.selection.layoutType === activeType
    ? lastSelection.selection : undefined;
  return JSON.stringify({
    mode: "inquiry", access: "read-only", knowledgeStatus: "source-capabilities-not-acceptance-proof",
    ...(selection ?? { layoutType: activeType, screenId: activeType === "renpy" ? "title" : "player", advanced: false }),
  });
}
