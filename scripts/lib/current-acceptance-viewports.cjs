"use strict";
const assert = require("node:assert/strict");
const desktopViewports = [[1920, 1080], [2560, 1440], [3840, 2160]];
function currentAcceptanceViewports(viewports = desktopViewports) {
  const selected = viewports.filter(([width, height]) =>
    desktopViewports.some(([allowedWidth, allowedHeight]) => width === allowedWidth && height === allowedHeight));
  assert(selected.length > 0, "Current acceptance must contain a nonempty 1080p/2K/4K landscape matrix");
  assert.equal(selected.length, viewports.length,
    "Current acceptance must not add sub-1080p or portrait viewports");
  return selected;
}
module.exports = { desktopViewports, currentAcceptanceViewports };
