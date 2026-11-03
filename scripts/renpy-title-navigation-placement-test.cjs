"use strict";
const assert = require("node:assert/strict"), { buildSync } = require("../editor/node_modules/esbuild");
const api = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: require("node:path").resolve(__dirname, ".."), loader: "ts",
    contents: 'export { placeRenpyTitleNavigation, renpyTitleObstacles } from "./shared/cartridge/renpyTitleControls";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(api, api.exports);
const { placeRenpyTitleNavigation: place, renpyTitleObstacles: obstacles } = api.exports;
const preferred = { x: 60, y: 320, width: 156, height: 440 };
const original = { component_id: "paid-result", component_type: "custom_component",
  visible: true, rect: { x: 8, y: 10, width: 20, height: 30 } };
const before = JSON.stringify(original), rects = obstacles([original], 1920, 1080);
assert.deepEqual(rects, [{ x: 153.6, y: 108, width: 384, height: 324 }]);
const area = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
let cases = 0;
for (const factor of [1, 4 / 3, 2]) {
  const scale = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v * factor]));
  const p = place(scale(preferred), rects.map(scale), 1920 * factor, 1080 * factor, 12 * factor);
  assert(p.clear); assert.equal(p.rect.x, preferred.x * factor);
  assert(p.rect.y >= 444 * factor); assert.equal(area(p.rect, scale(rects[0])), 0);
  assert(p.rect.x >= 0 && p.rect.y >= 0 && p.rect.x + p.rect.width <= 1920 * factor
    && p.rect.y + p.rect.height <= 1080 * factor);
  cases++;
}
assert.equal(JSON.stringify(original), before); cases++;
assert.deepEqual(place(preferred, [], 1920, 1080, 12), { rect: preferred, clear: true }); cases++;
assert.deepEqual(obstacles([{ ...original, visible: false }, { ...original, component_type: "main_menu_hero" }], 1920, 1080), []); cases++;
assert.deepEqual(obstacles([{ ...original, rect: { x: 50, y: 50, width: 20, height: 30, anchor: "center" } }], 1920, 1080),
  [{ x: 768, y: 378, width: 384, height: 324 }]); cases++;
const centered = place({ x: 40, y: 150, width: 150, height: 400 },
  [{ x: 0, y: 0, width: 300, height: 720 }], 1280, 720, 8);
assert(centered.clear && centered.rect.x >= 308); cases++;
const crowded = place(preferred, [{ x: 0, y: 0, width: 1920, height: 1080 }], 1920, 1080, 12);
assert.equal(crowded.clear, false); cases++;
const changed = place(preferred, [{ x: 0, y: 0, width: 360, height: 1080 }], 1920, 1080, 12);
assert(changed.clear && changed.rect.x >= 372); cases++;
console.log(JSON.stringify({ status: "PASS", cases, exactOriginalCoordinatesPreserved: true,
  scope: "PURE_PLACEMENT_NOT_BROWSER_OR_INSTALLED" }));
