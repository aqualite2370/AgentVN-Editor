/** Editor presentation only. Read before mutating/cloning a navigation tree;
 * share the same actual settings through that operation's animation owners.
 * A later operation reads again, so theme/motion changes are never cached globally. */
export type EditorMotionTokens = Readonly<{
  motionScale: number;
  crossfadeEasing: string;
  containerEasing: string;
  contentEasing: string;
  workspacePlaybackRate: number;
  siblingDurationMs: number;
  reducedSiblingDurationMs: number;
  siblingEasing: string;
}>;

function cssTimeMilliseconds(value: string, fallback: number): number {
  // Production CSS may serialize 1000ms as 1s (and 700ms as .7s).
  // Invalid/zero clocks keep the continuous handoff's existing safe default.
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/i.exec(value.trim());
  if (!match) return fallback;
  const milliseconds = Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : fallback;
}

export function readEditorMotionTokens(): EditorMotionTokens {
  const style = window.getComputedStyle(document.documentElement);
  const scale = Number(style.getPropertyValue("--motion-scale").trim());
  const workspaceRate = Number(style.getPropertyValue("--editor-workspace-playback-rate").trim());
  return {
    motionScale: Number.isFinite(scale) ? Math.max(0, scale) : 1,
    crossfadeEasing: style.getPropertyValue("--ease-editor-crossfade").trim(),
    containerEasing: style.getPropertyValue("--ease-editor-container").trim()
      || style.getPropertyValue("--ease-ui-in-out").trim(),
    contentEasing: style.getPropertyValue("--ease-ui-out").trim(),
    workspacePlaybackRate: Number.isFinite(workspaceRate) && workspaceRate > 0 ? workspaceRate : 1,
    siblingDurationMs: cssTimeMilliseconds(style.getPropertyValue("--motion-editor-sibling"), 1000),
    reducedSiblingDurationMs: cssTimeMilliseconds(style.getPropertyValue("--motion-editor-sibling-reduced"), 700),
    siblingEasing: style.getPropertyValue("--ease-editor-sibling").trim()
      || style.getPropertyValue("--ease-standard").trim(),
  };
}

/** Workbench clocks only. Do not use for home/container or GameCLI motion.
 * Scale associated fades/delays together so no old clock leaves a blank seam. */
export function editorWorkspaceDuration(milliseconds: number, tokens: EditorMotionTokens): number {
  return milliseconds / tokens.workspacePlaybackRate;
}

/** The live editor and outgoing visible page stay intact. Only the desktop
 * snapshot's invisible warm layout is simplified. Retain its grid/inspector
 * boundary: deleting that boundary changes outgoing compositing pixels. */
export function pruneHiddenLayoutSnapshot(
  ghost: HTMLElement,
  viewport: { width: number; height: number },
): number {
  if (!ghost.classList.contains("toolbar-popover-morph-ghost")
    || viewport.width < 1280 || viewport.height < 720) return 0;
  let removed = 0;
  for (const layer of ghost.querySelectorAll(
    '.advanced-tab-content.is-warm[data-tab="layout"][aria-hidden="true"]',
  )) {
    for (const node of layer.querySelectorAll(
      ".runtime-layout-header,.runtime-layout-sidebar,.runtime-layout-center",
    )) {
      removed += node.querySelectorAll("*").length + 1;
      node.remove();
    }
  }
  return removed;
}
