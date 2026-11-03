"use strict";
// Read-only native Runtime RAF observation. No stores, styles, animation or
// time overrides. Native viewport emulation is owned by the outer harness.
async function beginRuntimeMotion(page, name) {
  await page.evaluate(name => {
    window.__qaRuntimeMotion?.stop?.();
    const record = { name, startedAt: performance.now(), frames: [], inputs: [], events: [], done: false };
    const navAtStart = document.querySelector('[data-testid="renpy-menu-navigation"]');
    const rect = node => node?.getBoundingClientRect().toJSON() || null;
    const visual = node => {
      if (!node) return null;
      const css = getComputedStyle(node);
      return { opacity: Number(css.opacity), transform: css.transform, clipPath: css.clipPath, pointerEvents: css.pointerEvents,
        visibility: css.visibility, display: css.display, inert: node.inert, rect: rect(node),
        animations: node.getAnimations().map(a => ({ name: a.animationName || a.transitionProperty || "WAAPI",
          state: a.playState, duration: a.effect?.getTiming().duration, easing: a.effect?.getTiming().easing, time: a.currentTime })) };
    };
    const relevant = node => node instanceof Element && (node.closest("[data-runtime-screen-transition], .game-launch-blackout, .modal-backdrop, .playback-controls"));
    const event = e => { if (relevant(e.target)) record.events.push({ type: e.type, name: e.animationName || e.propertyName,
      at: performance.now(), target: e.target.className, elapsed: e.elapsedTime }); };
    const input = e => { const button = e.target instanceof Element ? e.target.closest("button") : null;
      record.inputs.push({ type: e.type, trusted: e.isTrusted, key: e.key, at: performance.now(),
        target: button?.getAttribute("data-testid"), label: button?.textContent?.trim(), x: e.clientX, y: e.clientY }); };
    for (const type of ["animationstart", "animationend", "animationcancel", "transitionrun", "transitionend", "transitioncancel"])
      document.addEventListener(type, event, true);
    for (const type of ["click", "keydown"]) document.addEventListener(type, input, true);
    record.stop = () => {
      record.done = true;
      for (const type of ["animationstart", "animationend", "animationcancel", "transitionrun", "transitionend", "transitioncancel"])
        document.removeEventListener(type, event, true);
      for (const type of ["click", "keydown"]) document.removeEventListener(type, input, true);
    };
    const frame = at => {
      const root = document.querySelector("[data-runtime-screen-transition]"), current = root?.querySelector(".runtime-screen-transition-current");
      const menuPages = new Set(["settings", "save_load", "history", "gallery", "about", "help"]);
      const withinSharedMenu = menuPages.has(root?.getAttribute("data-runtime-transition-from"))
        && menuPages.has(root?.getAttribute("data-runtime-transition-to"));
      // The actual animation owner is the full page for title/main-menu↔menu,
      // and only the content outlet for shared-menu↔shared-menu. Reading an
      // unanimated child falsely reports a blank/double flash.
      const surface = withinSharedMenu ? root?.querySelector("[data-runtime-motion-surface]") || current : current;
      const nav = root?.querySelector('[data-testid="renpy-menu-navigation"]'), focus = document.activeElement;
      const snapshot = Array.from(document.querySelectorAll("[data-runtime-transition-snapshot]"));
      const functional = selector => Array.from(document.querySelectorAll(selector)).filter(n => !n.closest("[data-runtime-transition-snapshot]"));
      const modal = document.querySelector("[data-runtime-modal='true']");
      record.frames.push({ at, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, hidden: document.hidden,
        phase: root?.getAttribute("data-runtime-transition-phase"), style: root?.getAttribute("data-runtime-transition-style"),
        from: root?.getAttribute("data-runtime-transition-from"), to: root?.getAttribute("data-runtime-transition-to"),
        screen: root?.getAttribute("data-runtime-presented-screen"), committed: root?.getAttribute("data-runtime-committed-screen"),
        duration: Number(root?.getAttribute("data-runtime-transition-duration") || 0),
        coverMs: root && parseFloat(getComputedStyle(root).getPropertyValue("--runtime-screen-cover-duration")),
        revealMs: root && parseFloat(getComputedStyle(root).getPropertyValue("--runtime-screen-reveal-duration")),
        black: root ? Number(getComputedStyle(root, "::before").opacity) : null,
        launch: visual(document.querySelector('[data-testid="game-launch-blackout"]')),
        launchClass: document.querySelector('[data-testid="game-launch-blackout"]')?.className,
        current: visual(current), surface: visual(surface), surfaceOwner: surface === current ? "full-page" : "shared-menu-content",
        nav: visual(nav), sameNavigation: navAtStart === nav,
        snapshots: snapshot.map(n => ({ ...visual(n), ariaHidden: n.getAttribute("aria-hidden"),
          category: Boolean(n.parentElement?.classList.contains("settings-content")) })),
        category: visual(document.querySelector("[data-settings-tab-current]")),
        categoryId: document.querySelector("[data-settings-tab-current]")?.getAttribute("data-settings-tab-current"),
        categoryPhase: document.querySelector("[data-settings-transition]")?.getAttribute("data-settings-transition"),
        categoryDuration: Number(document.querySelector("[data-settings-tab-duration]")?.getAttribute("data-settings-tab-duration") || 0),
        modal: visual(modal), backdrop: visual(modal?.parentElement), modalCount: document.querySelectorAll("[data-runtime-modal='true']").length,
        modalExits: Array.from(document.querySelectorAll("[data-runtime-modal-exit]")).map(n => ({
          ...visual(n), ariaHidden: n.getAttribute("aria-hidden"), focus: n.contains(focus),
          panel: visual(n.querySelector(".modal-panel")), backdrop: visual(n.firstElementChild),
          functionalModals: n.querySelectorAll("[data-runtime-modal='true']").length,
        })),
        modalSiblingsInert: modal ? [...modal.parentElement.parentElement.children]
          .filter(n => n !== modal.parentElement).every(n => n.inert) : null,
        modalFocus: Boolean(modal?.contains(focus)), focusTag: focus?.tagName, focusTestId: focus?.getAttribute("data-testid"),
        unavailableFocus: Boolean(focus && focus !== document.body && focus.closest("[inert], [hidden], [aria-hidden='true']")),
        snapshotFocus: Boolean(focus?.closest("[data-runtime-transition-snapshot]")),
        functionalLayerCount: document.querySelectorAll(".runtime-screen-transition-layer").length,
        playerCount: functional(".story-player").length, mediaCount: functional("audio,video").length,
        quick: visual(document.querySelector(".playback-controls")), quickClass: document.querySelector(".playback-controls")?.className,
        quickSurface: visual(document.querySelector(".quick-menu-surface")),
        quickButtons: Array.from(document.querySelectorAll(".quick-menu-action-layer > .quick-menu-button")).map(n => ({
          label: n.getAttribute("aria-label"), opacity: Number(getComputedStyle(n).opacity), visibility: getComputedStyle(n).visibility,
          animations: n.getAnimations().map(a => ({ name: a.animationName || a.transitionProperty || "WAAPI",
            state: a.playState, duration: a.effect?.getTiming().duration, time: a.currentTime })) })),
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth });
      if (!record.done && record.frames.length < 8192) requestAnimationFrame(frame);
      else if (!record.done) { record.limitReached = true; record.stop(); }
    };
    window.__qaRuntimeMotion = record; requestAnimationFrame(frame);
  }, name);
}
async function finishRuntimeMotion(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const r = window.__qaRuntimeMotion; r.stop();
    return { name: r.name, startedAt: r.startedAt, finishedAt: performance.now(), frames: r.frames, inputs: r.inputs, events: r.events,
      limitReached: Boolean(r.limitReached) };
  });
}
module.exports = { beginRuntimeMotion, finishRuntimeMotion };
