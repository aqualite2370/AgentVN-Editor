"use strict";

// Installed only by the acceptance runner, immediately around a real ADB touch.
function observeMenuAction(componentId) {
  window.__agentvnMenuActionObserver?.dispose?.();
  window.__agentvnMenuActionObserver?.observer.disconnect();
  const samples = [];
  const events = [];
  const sample = () => {
    const player = document.querySelector('.story-player');
    const button = document.querySelector(`[data-ui-component-id="${componentId}"]`);
    const value = { scene: player?.getAttribute('data-current-scene-id'),
      command: player?.getAttribute('data-current-command-index'), active: Boolean(button?.classList.contains('active')) };
    if (JSON.stringify(samples.at(-1)?.state) !== JSON.stringify(value)) samples.push({ at: performance.now(), state: value });
  };
  const observer = new MutationObserver(sample);
  observer.observe(document.querySelector('.story-player'), { subtree: true, attributes: true, attributeFilter: ['class', 'data-current-scene-id', 'data-current-command-index'] });
  const onInput = event => {
    const button = document.querySelector(`[data-ui-component-id="${componentId}"]`);
    const rect = button?.getBoundingClientRect();
    events.push({ at: performance.now(), type: event.type, trusted: event.isTrusted,
      x: event.clientX, y: event.clientY, target: event.target?.closest?.('[data-ui-component-id]')?.getAttribute('data-ui-component-id'),
      hitsButton: Boolean(button?.contains(event.target)), active: Boolean(button?.classList.contains('active')),
      rect: rect?.toJSON() });
  };
  const eventTypes = ['pointerdown', 'pointerup', 'pointercancel', 'click'];
  eventTypes.forEach(type => document.addEventListener(type, onInput, true));
  const dispose = () => {
    observer.disconnect();
    eventTypes.forEach(type => document.removeEventListener(type, onInput, true));
  };
  sample();
  window.__agentvnMenuActionObserver = { observer, sample, samples, events, dispose };
}

function finishMenuAction(includeInputEvents = false) {
  const entry = window.__agentvnMenuActionObserver;
  if (!entry) throw new Error('MENU_ACTION_OBSERVER_MISSING');
  entry.sample();
  entry.dispose ? entry.dispose() : entry.observer.disconnect();
  delete window.__agentvnMenuActionObserver;
  return includeInputEvents ? { samples: entry.samples, inputEvents: entry.events } : entry.samples;
}

function assessSkipAction(samples) {
  const initial = samples[0]?.state;
  const enabled = samples.some(sample => sample.state.active);
  const progressed = samples.some(sample => sample.state.scene &&
    (sample.state.scene !== initial?.scene || sample.state.command !== initial?.command));
  return { status: enabled && progressed ? 'PASS' : 'FAILED', enabled, progressed,
    activeAtEnd: Boolean(samples.at(-1)?.state.active), samples };
}

module.exports = { observeMenuAction, finishMenuAction, assessSkipAction };
