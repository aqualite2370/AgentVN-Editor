"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../GameCli_framework/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const result = esbuild.buildSync({
  stdin: {
    resolveDir: root,
    loader: "ts",
    contents: 'export { placeSpeechBubble } from "./shared/cartridge/bubblePlacement";',
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const bundle = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(bundle, bundle.exports);
const { placeSpeechBubble } = bundle.exports;

const viewport = { x: 100, y: 50, width: 1280, height: 720 };
const bubble = { width: 360, height: 160 };

const above = placeSpeechBubble({
  viewport,
  bubble,
  anchor: { x: 630, y: 420, width: 120, height: 260 },
});
assert.equal(above.anchor, "character");
assert.equal(above.tail, "bottom");
assert(
  above.y + bubble.height <= 420 - 12,
  "speech bubble should sit fully above the speaker with the configured gap",
);

const edgeSpeaker = placeSpeechBubble({
  viewport,
  bubble,
  anchor: { x: 12, y: 55, width: 80, height: 240 },
});
assert.equal(edgeSpeaker.tail, "top", "a speaker near the top edge should move the bubble below the sprite");
assert(edgeSpeaker.y >= 55 + 240 + 12, "the fallback bubble should not overlap a speaker whose head has no space above");
assert(edgeSpeaker.x >= viewport.x + 16, "bubble should stay inside the left safe edge");
assert(edgeSpeaker.y >= viewport.y + 16, "bubble should stay inside the top safe edge");
assert(edgeSpeaker.x + bubble.width <= viewport.x + viewport.width - 16);
assert(edgeSpeaker.y + bubble.height <= viewport.y + viewport.height - 16);

const fallback = placeSpeechBubble({
  viewport,
  bubble,
  obstacles: [{ x: 500, y: 55, width: 420, height: 72 }],
});
assert.equal(fallback.anchor, "fallback");
assert(fallback.y >= 143, "missing-speaker fallback should remain upper-center and clear the quick bar");

const fixed = placeSpeechBubble({
  viewport,
  bubble,
  fixed: { x: 96, y: 8 },
});
assert.equal(fixed.anchor, "fixed");
assert(fixed.x + bubble.width <= viewport.x + viewport.width - 16);
assert(fixed.y >= viewport.y + 16);

const quickBar = { x: 480, y: 620, width: 520, height: 100 };
const fixedNearQuickBar = placeSpeechBubble({
  viewport,
  bubble,
  fixed: { x: 50, y: 85 },
  obstacles: [quickBar],
});
assert.equal(fixedNearQuickBar.anchor, "fixed", "avoiding controls must preserve the authored fixed anchor mode");
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
assert(!overlap(fixedNearQuickBar, quickBar),
  "an authored fixed bubble must avoid the quick bar when there is room to move");
assert(fixedNearQuickBar.y >= viewport.y + 16
  && fixedNearQuickBar.y + bubble.height <= viewport.y + viewport.height - 16);

const tallAnchor = { x: 920, y: 16, width: 80, height: 1032 };
const sideOptions = { viewport: { x: 0, y: 0, width: 1920, height: 1080 }, bubble, anchor: tallAnchor };
const side = placeSpeechBubble(sideOptions);
const sideWithOffset = placeSpeechBubble({ ...sideOptions, offset: { x: -24, y: 0 } });
assert.equal(side.tail, "right", "fixture must exercise the left-side candidate");
assert.equal(sideWithOffset.x, side.x - 24,
  "authored horizontal offsets must also apply when the bubble is beside a speaker");

console.log("bubble-placement-contract: PASS");
