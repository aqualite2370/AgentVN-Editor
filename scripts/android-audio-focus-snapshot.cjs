"use strict";

async function readAudioFocusSnapshot(cdp) {
  return cdp.evaluate(`(() => ({
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    userAgent: navigator.userAgent,
  }))()`);
}

module.exports = { readAudioFocusSnapshot };
