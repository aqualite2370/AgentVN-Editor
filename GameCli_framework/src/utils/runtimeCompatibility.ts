import structuredCloneFallback from "core-js-pure/actual/structured-clone";
import { ResizeObserver as ResizeObserverFallback } from "@juggle/resize-observer";

// Imported before App and its stores: settings and StoryEngine clone state
// during module evaluation, so installing these from a React effect is too late.
// Keep a working native implementation; no setting or saved data is changed.
if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = structuredCloneFallback;
}
if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver = ResizeObserverFallback;
}
