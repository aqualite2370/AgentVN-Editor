"use strict";

// This function is also serialized into the installed Android WebView.
function renderedDialogGlyphs(element) {
  const rects = [];
  if (!element) return rects;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const range = document.createRange();
    // pre-wrap deliberately lets trailing spaces hang beyond a line's edge.
    // Their Range is not painted ink and does not contribute scroll overflow.
    // Measure all non-whitespace runs; retain the authored text unchanged.
    for (const match of node.textContent.matchAll(/\S+/gu)) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      rects.push(...[...range.getClientRects()].map(rect => rect.toJSON()));
    }
  }
  return rects;
}

module.exports = { renderedDialogGlyphs };
