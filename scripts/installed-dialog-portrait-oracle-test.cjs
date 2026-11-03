"use strict";
const assert = require("node:assert/strict");
const { validatePortrait } = require("./installed-dialog-portrait-oracle.cjs");
const image = { tag: "IMG", sha256: "new", visible: true, insideViewport: true, hit: true, inStory: true,
  inDialog: true, width: 90, height: 60 };
const good = { boundCommand: true, dialogVisible: true, dialogDone: true, horizontalOverflow: false, images: [image] };
assert.equal(validatePortrait(good, "new").matching, 1);
const bad = [
  { ...good, boundCommand: false }, { ...good, dialogDone: false }, { ...good, images: [] },
  { ...good, images: [{ ...image, sha256: "old" }] }, { ...good, images: [{ ...image, visible: false }] },
  { ...good, images: [{ ...image, inDialog: false }] }, { ...good, images: [{ ...image, inStory: false }] },
  { ...good, images: [{ ...image, tag: "PRELOAD" }] }, { ...good, images: [{ ...image, hit: false }] },
  { ...good, horizontalOverflow: true },
];
for (const value of bad) assert.throws(() => validatePortrait(value, "new"));
console.log("PASS:11 oracle cases; rejects preloads, generic overlays, wrong/hidden/non-player bytes and missing binding");
