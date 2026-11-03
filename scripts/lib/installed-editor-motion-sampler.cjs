"use strict";
// Rendered frame observer only. No animation cancellation, styles, mock data,
// time stretching, store mutation or source-server dependencies.
async function beginEditorMotion(page, name) {
  await page.evaluate(name => {
    window.__qaInstalledEditorMotion?.stop?.();
    const capture = { name, frames: [], events: [], inputs: [], done: false, start: performance.now() };
    const rect = n => {
      const r = n?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null;
    };
    const visual = n => {
      if (!n) return null;
      const s = getComputedStyle(n);
      return { rect: rect(n), opacity: Number(s.opacity), transform: s.transform, filter: s.filter, display: s.display,
        cssAnimationTimingFunction: s.animationTimingFunction,
        visibility: s.visibility, pointerEvents: s.pointerEvents, inert: Boolean(n.inert), ariaHidden: n.getAttribute("aria-hidden"),
        className: n.className, layout: { left: n.offsetLeft, top: n.offsetTop, width: n.offsetWidth, height: n.offsetHeight },
        animations: n.getAnimations().map(a => ({ name: a.animationName || a.transitionProperty || "WAAPI", state: a.playState,
          time: a.currentTime, duration: a.effect?.getTiming().duration, easing: a.effect?.getTiming().easing,
          iterations: a.effect?.getTiming().iterations,
          keyframes: a.effect?.getKeyframes().map(k => ({ offset: k.computedOffset, easing: k.easing })) })) };
    };
    const animationSeen = new WeakSet(), removals = [];
    const observeAnimations = nodes => {
      for (const n of nodes.filter(Boolean)) for (const a of n.getAnimations()) {
        if (animationSeen.has(a) || a.effect?.getTiming().iterations === Infinity) continue;
        animationSeen.add(a);
        const label = { target: n.className, name: a.animationName || a.transitionProperty || "WAAPI",
          duration: a.effect?.getTiming().duration, easing: a.effect?.getTiming().easing };
        capture.events.push({ ...label, type: "observed", at: performance.now(), time: a.currentTime });
        for (const type of ["finish", "cancel"]) {
          const listener = () => capture.events.push({ ...label, type, at: performance.now(), time: a.currentTime });
          a.addEventListener(type, listener); removals.push(() => a.removeEventListener(type, listener));
        }
      }
    };
    const relevant = target => target instanceof Element && Boolean(target.closest(".app-view, .workspace-task-panel, .toolbar-popover-morph-ghost"));
    const onAnimation = e => {
      if (relevant(e.target)) capture.events.push({ type: e.type, name: e.animationName, at: performance.now(),
        elapsedTime: e.elapsedTime, target: typeof e.target.className === "string" ? e.target.className : e.target.tagName });
    };
    const onInput = e => {
      const n = e.target instanceof Element ? e.target.closest("button") : null;
      if (e.type === "click" || e.type === "keydown")
        capture.inputs.push({ type: e.type, trusted: e.isTrusted, at: performance.now(), key: e.key,
          help: n?.getAttribute("data-help-key"), surface: n?.getAttribute("data-workspace-surface"), label: n?.textContent?.trim(),
          panelClosing: Boolean(document.querySelector(".workspace-task-panel.is-closing")),
          inPalette: Boolean(n?.closest(".node-palette")) });
    };
    for (const t of ["animationstart", "animationend", "animationcancel"]) document.addEventListener(t, onAnimation, true);
    for (const t of ["click", "keydown"]) document.addEventListener(t, onInput, true);
    capture.stop = () => {
      capture.done = true;
      for (const t of ["animationstart", "animationend", "animationcancel"]) document.removeEventListener(t, onAnimation, true);
      for (const t of ["click", "keydown"]) document.removeEventListener(t, onInput, true);
      for (const remove of removals) remove();
    };
    const frame = at => {
      const panel = document.querySelector(".workspace-task-panel:not(.toolbar-popover-morph-ghost)");
      const active = panel?.querySelector(".advanced-tab-content.is-active"), leaving = panel?.querySelector(".advanced-tab-content.is-leaving");
      const home = document.querySelector(".app-view-home"), editor = document.querySelector(".app-view-editor");
      const overlay = document.querySelector(".project-entry-loading-overlay");
      const palette = document.querySelector(".node-palette"), flow = document.querySelector(".flow-surface"), inspector = document.querySelector(".scene-editor-pane");
      const nav = panel?.querySelector(".advanced-tools-panel > nav"), focus = document.activeElement;
      const filtered = []; for (let n = palette; n; n = n.parentElement) if (getComputedStyle(n).filter !== "none") filtered.push({ className: n.className, filter: getComputedStyle(n).filter });
      const layers = Array.from(panel?.querySelectorAll(".advanced-tab-content") || []).map(n => ({
        tab: n.getAttribute("data-tab"), ...visual(n),
        interactive: n.getAttribute("data-advanced-tab-interactive"), pending: Boolean(n.querySelector(".advanced-tab-loading, .advanced-tab-preparing"))
      }));
      const ghosts = Array.from(document.querySelectorAll(".toolbar-popover-morph-ghost")).map(n => visual(n));
      const panelBox = rect(panel), inspectorBox = rect(inspector);
      let inspectorOverlapHit = null;
      if (panelBox && inspectorBox && panelBox.right > inspectorBox.left && panelBox.left < inspectorBox.right) {
        const left = Math.max(panelBox.left, inspectorBox.left), right = Math.min(panelBox.right, inspectorBox.right);
        const top = Math.max(panelBox.top, inspectorBox.top), bottom = Math.min(panelBox.bottom, inspectorBox.bottom);
        if (bottom > top && right > left) {
          const x = (left + right) / 2, y = (top + bottom) / 2, hit = document.elementFromPoint(x, y);
          inspectorOverlapHit = { x, y, width: right - left, height: bottom - top,
            hitClass: typeof hit?.className === "string" ? hit.className : hit?.tagName,
            belongsToPanel: Boolean(hit && panel.contains(hit)), belongsToInspector: Boolean(hit && inspector.contains(hit)) };
        }
      }
      const present = n => n?.querySelector(".toolbar-panel-presentation-layer")?.firstElementChild || n?.firstElementChild;
      capture.frames.push({ at, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        editorMotionTokens: Object.fromEntries(["--motion-editor-sibling", "--motion-editor-sibling-reduced",
          "--editor-workspace-playback-rate", "--motion-scale", "--ease-editor-sibling"]
          .map(key => [key, getComputedStyle(document.documentElement).getPropertyValue(key).trim()])),
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, pageHidden: document.hidden, visibilityState: document.visibilityState,
        selected: document.querySelector('[data-workspace-surface][aria-current="page"]')?.getAttribute("data-workspace-surface") || null,
        task: panel?.getAttribute("data-workspace-task") || null, panel: visual(panel), content: visual(present(panel)), home: visual(home), editor: visual(editor), overlay: visual(overlay),
        palette: visual(palette), paletteFilteredAncestors: filtered, flow: visual(flow), inspector: visual(inspector),
        bodyInert: Boolean(document.querySelector(".editor-workspace-body")?.inert),
        layers, activeTab: active?.getAttribute("data-tab") || null, leavingTab: leaving?.getAttribute("data-tab") || null,
        phase: panel?.querySelector(".advanced-tools-panel")?.className || null,
        inspectorOverlapHit, nav: visual(nav), buttons: Array.from(nav?.querySelectorAll("button") || []).map(n => ({
          label: n.textContent.trim(), key: n.getAttribute("data-help-key"), width: n.offsetWidth, height: n.offsetHeight, rect: rect(n),
          selected: n.getAttribute("data-glass-selected") === "true"
        })), ghosts,
        overflow: document.documentElement.scrollWidth - innerWidth,
        focus: { tag: focus?.tagName, text: focus?.textContent?.trim().slice(0, 100),
          surface: focus?.getAttribute("data-workspace-surface"), help: focus?.getAttribute("data-help-key"),
          inPanel: Boolean(panel?.contains(focus)), inClosingPanel: Boolean(panel?.classList.contains("is-closing") && panel.contains(focus)),
          inUnavailable: Boolean(focus && focus !== document.body && focus.closest("[inert], [hidden], [aria-hidden='true']")) },
        iframeCount: editor?.querySelectorAll("iframe").length || 0 });
      observeAnimations([home, editor, overlay, panel, present(panel), active, leaving, flow, ...document.querySelectorAll(".toolbar-popover-morph-ghost")]);
      if (!capture.done && capture.frames.length < 4096) requestAnimationFrame(frame);
      else if (!capture.done) { capture.limitReached = true; capture.stop(); }
    };
    window.__qaInstalledEditorMotion = capture; requestAnimationFrame(frame);
  }, name);
}
async function finishEditorMotion(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const c = window.__qaInstalledEditorMotion; c.stop();
    return { name: c.name, startedAt: c.start, finishedAt: performance.now(), frames: c.frames, events: c.events, inputs: c.inputs, limitReached: Boolean(c.limitReached) };
  });
}
module.exports = { beginEditorMotion, finishEditorMotion };
