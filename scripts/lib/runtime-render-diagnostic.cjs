"use strict";
// Temporary in-memory diagnostic, installed only in isolated QA preview frames.
// No React setters, store writes, renderer overrides or source-file changes.
function runtimeRenderDiagnosticInit(options = {}) {
  if (!location.pathname.includes("/gamecli-preview/")) return;
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    window.__agentvnRenderTrace = { status: "EXISTING_HOOK_NOT_REPLACED" }; return;
  }
  const ids = new WeakMap(); let nextId = 1;
  const id = value => {
    if (!ids.has(value)) ids.set(value, nextId++);
    return ids.get(value);
  };
  const describe = value => {
    if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value ?? null;
    if (typeof value === "string") return value.slice(0, 120);
    if (typeof value === "function") return { kind: "function", id: id(value), name: value.name };
    if (Array.isArray(value)) return { kind: "array", id: id(value), length: value.length,
      sample: value.slice(0, 3).map(item => typeof item === "string" ? item.slice(0, 80)
        : item === null || typeof item !== "object" ? typeof item : { id: id(item) }) };
    if (typeof value === "object") return { kind: "object", id: id(value), keys: Object.keys(value).slice(0, 10) };
    return { kind: typeof value };
  };
  const trace = window.__agentvnRenderTrace = {
    status: "INSTALLED_READ_ONLY_DIAGNOSTIC", rendererCount: 0, commits: 0,
    snapshots: [], names: [], recentInit: [], errors: [], diagnosticOnlyNotAcceptance: true,
  };
  const names = new Set();
  const changedHooks = fiber => {
    let current = fiber.memoizedState, previous = fiber.alternate?.memoizedState, index = 0;
    const changed = [];
    while (current && index < 160) {
      const a = current.memoizedState, b = previous?.memoizedState;
      if (!Object.is(a, b)) {
        const value = { index, before: describe(b), after: describe(a) };
        if (a && typeof a === "object" && Array.isArray(a.deps)) {
          const old = b?.deps ?? [];
          value.dependencyChanges = a.deps.flatMap((entry, i) => Object.is(entry, old[i]) ? []
            : [{ index: i, before: describe(old[i]), after: describe(entry) }]);
        }
        changed.push(value);
      }
      current = current.next; previous = previous?.next; index++;
    }
    return { hookCount: index, changed };
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject() { return ++trace.rendererCount; },
    onCommitFiberRoot(_renderer, root) {
      try {
        trace.commits++;
        const pending = [root.current], dialogs = [];
        let visited = 0;
        while (pending.length && visited++ < 5000) {
          const fiber = pending.pop(), name = fiber.type?.name;
          if (name && names.size < 120) names.add(name);
          // Eo is the exact production DialogBox name in the captured chunk.
          if (name === "DialogBox" || name === "Eo") dialogs.push({ name, ...changedHooks(fiber) });
          if (fiber.sibling) pending.push(fiber.sibling);
          if (fiber.child) pending.push(fiber.child);
        }
        const node = document.querySelector(".dialog-box");
        const text = document.querySelector(".dialog-text");
        const textStyle = text ? getComputedStyle(text) : null;
        trace.snapshots.push({ commit: trace.commits, at: performance.now(), dialogs,
          viewport: [innerWidth, innerHeight],
          dialog: node ? { rect: node.getBoundingClientRect().toJSON(),
            font: node.getAttribute("data-dialog-font-scale"), pages: node.getAttribute("data-dialog-pages"),
            contentMode: node.getAttribute("data-dialog-content-mode") } : null,
          text: text ? { rect: text.getBoundingClientRect().toJSON(),
            client: [text.clientWidth, text.clientHeight], scroll: [text.scrollWidth, text.scrollHeight],
            inlineFont: text.style.fontSize, fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight,
            fontFamily: textStyle.fontFamily, fontWeight: textStyle.fontWeight,
            letterSpacing: textStyle.letterSpacing, padding: textStyle.padding,
            boxSizing: textStyle.boxSizing, wordBreak: textStyle.wordBreak, overflowWrap: textStyle.overflowWrap } : null });
        if (trace.snapshots.length > 48) trace.snapshots.shift();
        trace.names = [...names];
      } catch (error) { trace.errors.push(String(error)); }
    },
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
  addEventListener("message", event => {
    if (event.data?.type !== "agentvn.live-preview.init") return;
    const message = event.data;
    trace.recentInit.push({ at: performance.now(), revision: message.revision,
      sessionId: message.sessionId, screen: message.screen, layout: message.uiSkin?.layout_type ?? "agentvn" });
    if (trace.recentInit.length > 12) trace.recentInit.shift();
    // Opt-in replay seam for this isolated QA fixture only. Never copied into
    // trace/error telemetry; no arbitrary project payload capture.
    const permitted = "installed-portrait-20261021-01-renpy-layout-preview";
    if (options.captureGameId === permitted && message.manifest?.game_id === permitted
      && event.source === window.parent && event.origin === location.origin) {
      window.__agentvnReplayInit = JSON.parse(JSON.stringify(message));
    }
  });
}
module.exports = { runtimeRenderDiagnosticInit };
