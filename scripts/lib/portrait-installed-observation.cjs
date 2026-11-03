"use strict";
// Read-only observations and geometric assertions; no Runtime/store writes.
const assert = require("node:assert/strict");
async function portraitObservation(frame) {
  return frame.evaluate(async () => {
    const image = document.querySelector(".dialog-portrait"), panel = document.querySelector(".dialog-box"),
      speaker = panel?.querySelector(".speaker"), body = panel?.querySelector(".dialog-text");
    if (!image || !panel || !speaker || !body) throw Error("Visible portrait dialogue required");
    await image.decode();
    const bytes = await (await fetch(image.currentSrc)).arrayBuffer();
    const range = document.createRange(); range.selectNodeContents(body);
    const bounds = image.getBoundingClientRect();
    return { image: bounds.toJSON(), panel: panel.getBoundingClientRect().toJSON(),
      stage: panel.closest(".story-player")?.getBoundingClientRect().toJSON(),
      speaker: speaker.getBoundingClientRect().toJSON(), body: body.getBoundingClientRect().toJSON(),
      imageSha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map(b => b.toString(16).padStart(2, "0")).join(""),
      scale: parseFloat(getComputedStyle(panel).getPropertyValue("--runtime-ui-scale")) || 1,
      panelScale: panel.getBoundingClientRect().width / panel.offsetWidth,
      textRects: [...range.getClientRects()].map(r => r.toJSON()),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      overflow: document.documentElement.scrollWidth - innerWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      visible: image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      hit: document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === image,
      text: body.textContent };
  });
}
function verifyPortrait(o, hash) {
  assert(o.visible && o.hit, "Portrait must be visible and actually hit-testable");
  assert.equal(o.imageSha256, hash);
  assert(o.image.width > 0 && o.image.height > 0);
  assert(o.image.left >= 0 && o.image.top >= 0 && o.image.right <= o.viewport.width + 1
    && o.image.bottom <= o.viewport.height + 1);
  assert(o.overflow <= 1 && o.bodyOverflow <= 1);
  assert(o.textRects.every(r => r.right <= o.image.left + 1 || r.left >= o.image.right - 1
    || r.bottom <= o.image.top + 1 || r.top >= o.image.bottom - 1), "Portrait overlaps body glyphs");
}
function close(a, b) { assert(Math.abs(a - b) <= 1, `Geometry ${a} != ${b}`); }
function verifyCustom(o, config) {
  const scale = o.scale * o.panelScale;
  const safe = { left: Math.max(0, o.stage?.left ?? 0) + 12, top: Math.max(0, o.stage?.top ?? 0) + 12,
    right: Math.min(o.viewport.width, o.stage?.right ?? o.viewport.width) - 12,
    bottom: Math.min(o.viewport.height, o.stage?.bottom ?? o.viewport.height) - 12 };
  const size = Math.min(config.size * scale, safe.right - safe.left, safe.bottom - safe.top);
  const intendedLeft = o.speaker.left + (config.offsetX - 12) * scale - size;
  const intendedTop = o.speaker.top + (o.speaker.height - size) / 2 + config.offsetY * scale;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  close(o.image.width, size); close(o.image.height, size);
  close(o.image.left, clamp(intendedLeft, safe.left, safe.right - size));
  close(o.image.top, clamp(intendedTop, safe.top, safe.bottom - size));
}
module.exports = { portraitObservation, verifyPortrait, verifyCustom, close };
