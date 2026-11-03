"use strict";
const assert = require("node:assert/strict");
function validatePortrait(o, expectedHash) {
  assert.equal(o.boundCommand, true, "The currently displayed command must explicitly bind the portrait");
  assert.equal(o.dialogVisible, true);
  assert.equal(o.dialogDone, true);
  const matching = o.images.filter(i => i.sha256 === expectedHash && i.visible && i.insideViewport && i.hit
    && i.width > 0 && i.height > 0 && i.tag === "IMG" && i.inStory);
  // A network response, generic show_image, hidden preload or editor thumbnail
  // must never stand in for the actual player's visible portrait.
  assert(matching.some(i => i.inDialog || i.portraitRole), "No visible dedicated dialogue portrait consumes the bound bytes");
  assert.equal(o.horizontalOverflow, false);
  return { matching: matching.length };
}
module.exports = { validatePortrait };
