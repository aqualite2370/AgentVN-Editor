"use strict";
const assert = require("node:assert/strict");

// Arm before real browser input. Never seek, pause or replace the production
// animation clock; collect rendered frames until its actual final state.
async function armFloatingMotion(page, selector, {
  input = "click", key, visible = true, settledView,
} = {}) {
  await page.evaluate(({ selector, input, key, visible, settledView }) => {
    window.__floatingMotionProbe?.cancel?.();
    const probe = { selector, input, key, expectedVisible: visible,
      frames: [], events: [], done: false, triggered: false };
    let frameId, finalFrames = 0;
    const read = target => {
      const element = document.querySelector(target);
      if (!element) return { mounted: false, visible: false, animations: [] };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        mounted: true, visible: style.visibility !== "hidden" && style.display !== "none",
        opacity: Number(style.opacity), transform: style.transform,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        inert: Boolean(element.closest("[inert]")),
        ownsFocus: element.contains(document.activeElement),
        view: element.getAttribute("data-token-view"),
        animations: element.getAnimations().map(animation => ({
          playState: animation.playState, pending: animation.pending,
          currentTime: animation.currentTime,
          duration: animation.effect?.getTiming().duration,
          easing: animation.effect?.getTiming().easing,
        })),
      };
    };
    const sample = (time, rendered) => {
      const measurementStartedAt = performance.now();
      const frame = { time, rendered, visibility: document.visibilityState, focused: document.hasFocus(), target: read(selector),
        panel: read('[data-testid="novel-task-workbench"]'),
        backdrop: read(".novel-task-backdrop"),
        canvas: read(".editor-workspace > .flow-surface"),
        palette: read(".node-palette"),
        inspector: read(".scene-editor-pane"),
        card: read(".novel-task-card-material"),
        activeElement: document.activeElement?.className,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        pageWidth: document.documentElement.scrollWidth };
      frame.measurementMs = performance.now() - measurementStartedAt;
      probe.frames.push(frame);
      return frame;
    };
    const trigger = event => {
      if (probe.triggered || !event.isTrusted || (key && event.key !== key)) return;
      probe.triggered = true;
      probe.startedAt = performance.now();
      probe.events.push({ type: event.type, key: event.key, trusted: event.isTrusted });
      sample(probe.startedAt, false);
      window.removeEventListener(input, trigger, true);
    };
    const frame = time => {
      if (probe.triggered) {
        const record = sample(time, true);
        const target = record.target;
        const active = target.animations.some(animation =>
          animation.pending || animation.playState === "running");
        const reached = visible
          ? target.mounted && target.visible && target.opacity >= .999 && !target.inert
            && (!settledView || target.view === settledView)
          : !target.mounted || !target.visible;
        finalFrames = reached && !active ? finalFrames + 1 : 0;
        if (finalFrames >= 2) {
          probe.done = true;
          probe.finishedAt = time;
          return;
        }
      }
      frameId = requestAnimationFrame(frame);
    };
    probe.cancel = () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener(input, trigger, true);
    };
    // Observe before the production document Escape handler intentionally stops
    // propagation, without altering its topmost-modal ownership behavior.
    window.addEventListener(input, trigger, true);
    frameId = requestAnimationFrame(frame);
    window.__floatingMotionProbe = probe;
  }, { selector, input, key, visible, settledView });
}

async function finishFloatingMotion(page) {
  await page.waitForFunction(() => window.__floatingMotionProbe?.done, undefined, { timeout: 5000 });
  return page.evaluate(() => {
    const { cancel, ...result } = window.__floatingMotionProbe;
    cancel();
    return result;
  });
}

function assertFloatingMotion(probe, viewport, { reduced = false, duration, minOpacity = 0 } = {}) {
  assert(probe.triggered && probe.events.some(event => event.trusted), "Motion requires real user input");
  const frames = probe.frames.filter(frame => frame.rendered);
  assert(frames.length >= 2, "Motion requires multiple rendered frames and a settled final state");
  const intermediate = frames.filter(frame => frame.target.visible
    && frame.target.opacity > minOpacity + .005 && frame.target.opacity < .99);
  assert(intermediate.length > 0,
    `Continuous ${probe.input}/${probe.key || ""} transition missing: ${JSON.stringify(probe)}`);
  const animated = frames.flatMap(frame => frame.target.animations);
  assert(animated.some(animation => animation.duration === duration),
    `Expected ${duration}ms production transition, got ${JSON.stringify(animated)}`);
  const visibleFrames = frames.filter(frame => frame.target.visible);
  for (const frame of visibleFrames) {
    const target = frame.target;
    assert(frame.viewport.width === viewport.width && frame.viewport.height === viewport.height,
      "Sampling must preserve the requested landscape viewport");
    assert(frame.pageWidth <= viewport.width + 1, "Transition must not produce horizontal overflow");
    assert(target.x >= -1 && target.y >= -1
      && target.x + target.width <= viewport.width + 1
      && target.y + target.height <= viewport.height + 1, "Every transition frame must remain inside viewport");
    if (reduced) assert(target.transform === "none", "Reduced motion must preserve the fade without spatial movement");
    if (!probe.expectedVisible) assert(target.inert, "Leaving task panel must immediately surrender input");
  }
  if (visibleFrames.length) {
    const first = visibleFrames[0].target;
    assert(visibleFrames.every(frame => Math.abs(frame.target.width - first.width) <= 1
      && Math.abs(frame.target.height - first.height) <= 1), "Animation must not deform layout dimensions");
  }
  if (probe.selector === '[data-testid="novel-task-workbench"]') {
    assert(frames.some(frame => frame.backdrop.mounted
      && frame.backdrop.opacity > .005 && frame.backdrop.opacity < .99),
    "Task background must continuously hand off with the panel, including reduced motion");
    for (const frame of visibleFrames) {
      const { target, backdrop, canvas, palette, inspector } = frame;
      assert(backdrop.x >= palette.x + palette.width - 1
        && backdrop.x + backdrop.width <= inspector.x + 1,
      "Every rendered backdrop frame must leave node controls and Inspector clear");
      assert(target.x >= canvas.x - 1 && target.x + target.width <= canvas.x + canvas.width + 1
        && target.y >= canvas.y - 1 && target.y + target.height <= canvas.y + canvas.height + 1,
      "Every task transition frame must respect the actual canvas track");
    }
    if (!probe.expectedVisible) {
      for (let index = 1; index < visibleFrames.length; index++) {
        assert(visibleFrames[index].target.opacity <= visibleFrames[index - 1].target.opacity + .01,
          "Exiting task must not flash back to default opacity before unmount");
        assert(visibleFrames[index].backdrop.opacity <= visibleFrames[index - 1].backdrop.opacity + .01,
          "Exiting task backdrop must fade continuously without a late opacity rebound");
      }
    }
  }
  return { renderedFrames: frames.length, intermediateFrames: intermediate.length,
    observedMs: probe.finishedAt - probe.startedAt };
}

module.exports = { armFloatingMotion, finishFloatingMotion, assertFloatingMotion };
