"use strict";
const assert = require("node:assert/strict");

// Injected only into a separate diagnostic session. Reads DOM and native
// animation state; does not patch the engine, ResizeObserver, audio or inputs.
function installChoiceFrameProbe(options = {}) {
  if (window.__QA_NVL_CHOICE_PROBE__) throw new Error("Choice probe already installed");
  const ordinary = options.kind === "dialog";
  let frames = [], observer, raf = 0, active = false, afterChoice = 0;
  function sample(phase) {
    const panel = document.querySelector(ordinary ? ".dialog-box" : ".dialog-box.is-nvl-presentation");
    const region = panel?.querySelector(ordinary ? ".dialog-text" : ".nvl-page");
    const current = ordinary ? region : region?.querySelector('[data-nvl-current="true"] .nvl-page-text');
    const choice = panel?.querySelector(".choice-panel");
    const button = choice?.querySelector("button");
    const state = document.querySelector('[data-testid="game-state-playing"]');
    const rect = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const range = document.createRange();
    if (current) range.selectNodeContents(current);
    const buttonRect = rect(button), style = panel && getComputedStyle(panel);
    const f = {
      phase, at: performance.now(), timeOrigin: performance.timeOrigin,
      visibility: document.visibilityState, fontStatus: document.fonts?.status,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      scene: state?.getAttribute("data-current-scene-id"),
      command: Number(state?.getAttribute("data-current-command-index")),
      page: Number(panel?.getAttribute("data-dialog-page")),
      pages: Number(panel?.getAttribute("data-dialog-pages")),
      done: panel?.getAttribute("data-dialog-page-done") === "true",
      panel: rect(panel), region: rect(region), advance: rect(panel?.querySelector(".nvl-advance-surface")),
      currentText: current?.textContent, currentFont: current && getComputedStyle(current).fontSize,
      glyphs: current ? [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
        .map(r => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom })) : [],
      choice: rect(choice), button: buttonRect, choiceEnabled: !!button && !button.disabled,
      choiceHit: !!buttonRect && button.contains(document.elementFromPoint(
        buttonRect.x + buttonRect.width / 2, buttonRect.y + buttonRect.height / 2)),
      panelStyle: style && { height: style.height, maxHeight: style.maxHeight, gap: style.rowGap,
        paddingTop: style.paddingTop, paddingBottom: style.paddingBottom },
      lines: region ? [...region.querySelectorAll("[data-nvl-line]")].map(n => ({
        current: n.getAttribute("data-nvl-current"), text: n.textContent, rect: rect(n),
      })) : [],
      animations: panel ? panel.getAnimations({ subtree: true }).map(a => ({
        name: a.animationName || a.transitionProperty || "", state: a.playState,
        currentTime: a.currentTime, timing: a.effect?.getComputedTiming(),
      })) : [],
    };
    frames.push(f);
    return f;
  }
  function finish() {
    active = false; cancelAnimationFrame(raf); observer?.disconnect();
    return frames;
  }
  function tick() {
    if (!active) return;
    const f = sample("raf");
    if (ordinary ? f.scene === "voice_dialog" && f.command === 0 && f.done
      : f.choice && f.command === 24) afterChoice++;
    // This is a bounded observation window, not a product readiness delay.
    // Every failing frame stays in the trace even if a later frame recovers.
    if (afterChoice >= 90 || frames.length >= 1500) { finish(); return; }
    raf = requestAnimationFrame(tick);
  }
  window.__QA_NVL_CHOICE_PROBE__ = {
    start() {
      if (active || frames.length) throw new Error("Choice probe is single use");
      active = true; sample("before");
      const target = document.querySelector(".story-player");
      if (!target) throw new Error("Playing surface absent");
      observer = new MutationObserver(() => { if (active) sample("mutation"); });
      observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
      raf = requestAnimationFrame(tick);
    },
    capture: () => sample("after"),
    read: () => ({ active, frames }),
    finish,
  };
}

function analyzeFrames(frames, ordinary) {
  assert(Array.isArray(frames) && frames.length >= 3, "Nonempty before/after trace required");
  const first = frames[0], viewport = first.viewport;
  assert(viewport && viewport.width > 0 && viewport.height > 0 &&
    Number.isFinite(viewport.dpr) && [1, 2].some(dpr => Math.abs(viewport.dpr - dpr) <= 1e-6),
    "DPR must match 1/2 within the established WebView numeric-tail tolerance; retain raw values");
  assert(frames.some(f => ordinary ? f.scene === "narrative_entry"
    : f.scene === "capacity" && f.command === 23 && !f.choice), "Missing state before target trigger");
  for (const f of frames) {
    assert(["before", "mutation", "raf", "after"].includes(f.phase));
    assert(Number.isFinite(f.at));
    assert.deepEqual(f.viewport, viewport, "Viewport/media must not change during trace");
  }
  const choices = frames.filter(f => ordinary ? f.scene === "voice_dialog" && f.command === 0 && f.done
    : f.scene === "capacity" && f.command === 24 && f.choice);
  const rendered = choices.filter(f => f.phase === "raf");
  assert(rendered.length >= 2, "Need at least two animation-frame samples at the target");
  const bad = f => {
    assert(f.region && f.panel && f.currentText && f.glyphs.length, "Missing actual text/geometry");
    return f.glyphs.some(r => r.x < f.region.x - 2 || r.right > f.region.right + 2 ||
      r.y < f.region.y - 2 || r.bottom > f.region.bottom + 2 || (!ordinary && r.bottom > f.choice.y + 1));
  };
  const badSamples = choices.filter(bad), badFrames = rendered.filter(bad);
  const endBad = bad(rendered.at(-1));
  return {
    targetScene: ordinary ? "voice_dialog" : "capacity", targetCommand: ordinary ? 0 : 24,
    classification: endBad ? "FRAME_OVERFLOW_AT_END" : badFrames.length ? "FRAME_OVERFLOW_RECOVERED" :
      badSamples.length ? "MUTATION_ONLY_OVERFLOW" : "NO_OVERFLOW_OBSERVED",
    totalSamples: frames.length, choiceSamples: choices.length, animationFrameSamples: rendered.length,
    badAnimationFrameCount: badFrames.length, badMutationCount: badSamples.filter(f => f.phase === "mutation").length,
    firstChoiceAt: choices[0].at, lastSampleAt: rendered.at(-1).at,
    badSamples: badSamples.map(f => ({ phase: f.phase, at: f.at, command: f.command,
      page: f.page, pages: f.pages, done: f.done, region: f.region, choice: f.choice,
      glyphBottom: Math.max(...f.glyphs.map(r => r.bottom)), currentText: f.currentText })),
    scope: "GEOMETRY_OBSERVATION_NOT_COMPOSITOR_OR_OVERALL_ACCEPTANCE",
  };
}
const analyzeChoiceFrames = frames => analyzeFrames(frames, false);
const analyzeDialogFrames = frames => analyzeFrames(frames, true);
module.exports = { installChoiceFrameProbe, analyzeChoiceFrames, analyzeDialogFrames };
