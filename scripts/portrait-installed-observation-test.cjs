"use strict";
const assert = require("node:assert/strict");
const { verifyCustom, verifyPortrait } = require("./lib/portrait-installed-observation.cjs");
const config = { offsetX: -16, offsetY: -12, size: 48 };
const rect = (left, top, width, height) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height });
const fixture = {
  image: rect(224, 77, 48, 48), speaker: rect(300, 100, 200, 26), stage: rect(0, 0, 1920, 1080),
  scale: 1, panelScale: 1, viewport: { width: 1920, height: 1080 }, visible: true, hit: true,
  imageSha256: "controlled", overflow: 0, bodyOverflow: 0, textRects: [rect(400, 200, 500, 40)],
};
verifyCustom(fixture, config); verifyPortrait(fixture, "controlled");
let cases = 2;
const left = structuredClone(fixture); left.speaker = rect(74, 100, 200, 26); left.image = rect(12, 77, 48, 48);
verifyCustom(left, config); cases++;
const top = structuredClone(fixture); top.speaker = rect(300, 2, 200, 26); top.image = rect(224, 12, 48, 48);
verifyCustom(top, config); cases++;
const bottom = structuredClone(fixture); bottom.speaker = rect(300, 1090, 200, 26); bottom.image = rect(224, 1020, 48, 48);
verifyCustom(bottom, config); cases++;
for (const mutate of [
  o => { o.image.left += 4; }, o => { o.image.top += 4; }, o => { o.image.width -= 4; },
  o => { o.image.height += 4; },
]) { const bad = structuredClone(fixture); mutate(bad); assert.throws(() => verifyCustom(bad, config)); cases++; }
for (const mutate of [
  o => { o.hit = false; }, o => { o.visible = false; }, o => { o.imageSha256 = "old-bytes"; },
  o => { o.overflow = 5; }, o => { o.bodyOverflow = 5; }, o => { o.textRects = [o.image]; },
]) { const bad = structuredClone(fixture); mutate(bad); assert.throws(() => verifyPortrait(bad, "controlled")); cases++; }
console.log(`PASS portrait observation oracle ${cases} positive/negative cases`);
