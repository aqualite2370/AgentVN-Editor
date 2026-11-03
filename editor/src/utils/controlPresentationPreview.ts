import { useMemo, useRef } from "react";
import { compileControlPresentation, layoutPresentationTargets, type ControlPresentationSource } from "../../../shared/cartridge/controlPresentation";
import type { UISkinLayout } from "../../../shared/cartridge/uiSkin";

/** Bad authoring text belongs to the draft, never the live Runtime payload.
 * Cache identity includes the project, so A→B cannot borrow another preview. */
export function useControlPresentationPreview(layout: UISkinLayout, projectId: string): UISkinLayout {
  const identity = `${projectId}:${layout.layout_type ?? "agentvn"}`;
  const lastValid = useRef<{ projectId: string; sources: Map<string, ControlPresentationSource> }>({
    projectId, sources: new Map(),
  });
  return useMemo(() => {
    if (lastValid.current.projectId !== identity)
      lastValid.current = { projectId: identity, sources: new Map() };
    const preview = structuredClone(layout);
    const targets = layoutPresentationTargets(preview);
    const keys = new Set(targets.map(target => target.key));
    for (const key of lastValid.current.sources.keys()) if (!keys.has(key)) lastValid.current.sources.delete(key);
    for (const target of targets) {
      const key = target.key;
      if (compileControlPresentation(target.source).ok) {
        lastValid.current.sources.set(key, structuredClone(target.source));
      } else {
        target.set(lastValid.current.sources.get(key));
      }
    }
    return preview;
  }, [layout, identity]);
}
