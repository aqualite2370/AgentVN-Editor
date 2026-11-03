#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, "..");
if (process.argv.includes("--check-bundle")) assert.equal(
  fs.readFileSync(path.join(root, "shared/cartridge/quickMenuMetrics.ts"), "utf8"),
  fs.readFileSync(path.join(root, "editor/src-tauri/bundle-workspace/shared/cartridge/quickMenuMetrics.ts"), "utf8"));
const loaded = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { loader: "ts", resolveDir: root,
  contents: 'export * from "./shared/cartridge/quickMenuMetrics"; export * from "./shared/cartridge/quickMenuDefaults";' },
  bundle: true, format: "cjs", platform: "node", write: false }).outputFiles[0].text)(loaded, loaded.exports);
const { resolveQuickMenuPresentation: resolve, resolveQuickMenuSurfaceMetrics: metrics,
  normalizeQuickMenuVariant, resolveQuickMenuDirection, QUICK_MENU_KNOWN_DEFAULT_FINGERPRINTS } = loaded.exports;
let cases = 0;
for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
  for (const mobile of [false, true]) for (const renderScale of [1, .25]) {
    const base = { authoredFrame: { width, height }, viewport: { width, height }, mobile, renderScale,
      dialogRect: { x: 6, y: 76, width: 88, height: 18 }, dialogueTop: height * .76 };
    for (const rect of [undefined, ...QUICK_MENU_KNOWN_DEFAULT_FINGERPRINTS.flatMap(f => [f.rect, f.mobileRect])]) {
      const before = JSON.stringify(rect), input = { ...base, layout: { rect } };
      const c = resolve({ ...input, state: "collapsed" }), e = resolve({ ...input, state: "expanded" });
      assert.equal(e.placement, "dialog-top-right");
      assert(Math.abs(c.root.left + c.root.width - width * .94 * renderScale) < .01);
      assert(Math.abs(c.root.top + c.root.height - (height * .76 - 8) * renderScale) < .01);
      assert(Math.abs(c.root.left - e.root.left - e.toggle.left) < .01);
      assert(Math.abs(c.root.top - e.root.top - e.toggle.top) < .01);
      assert.equal(c.uniformScale, e.uniformScale);
      assert.equal(e.actions.columns, 1); assert.equal(e.actions.rows, 8);
      assert.equal(e.scrollable, false); assert.equal(e.surface.height, e.surface.contentHeight);
      assert(e.surface.width / (width * renderScale) >= (mobile ? .29 : .22));
      assert(Math.abs(e.actions.actionHitSize / 56 - e.uniformScale) < .01);
      assert(Math.abs(e.actions.surfacePadding / 8 - e.uniformScale) < .01);
      assert(Math.abs(e.actions.actionGap / 8 - e.uniformScale) < .01);
      assert(Math.abs(e.surface.height - 520 * e.uniformScale) < .01);
      assert.equal(JSON.stringify(rect), before, "Rendering must never rewrite project coordinates");
      cases++;
    }
    for (const anchor of ["top_right", "top_left", "center", "bottom_right"])
      for (const y of [2, 35, 51, 90]) {
        const input = { ...base, layout: { rect: { x: 82, y, width: 18, height: 8, anchor } } };
        const c = resolve({ ...input, state: "collapsed" }), e = resolve({ ...input, state: "expanded" });
        assert.equal(e.placement, "authored");
        assert(Math.abs(c.root.left - e.root.left - e.toggle.left) < .01);
        assert(Math.abs(c.root.top - e.root.top - e.toggle.top) < .01);
        assert(e.root.left >= 0 && e.root.top >= 0 && e.root.left + e.root.width <= width * renderScale);
        assert(e.root.top + e.root.height <= height * .76 * renderScale + .01);
        if (renderScale === 1 && anchor === "top_right" && y === 51) {
          assert(Math.abs(c.root.left + c.root.width - width * .82 * renderScale) < .01);
          assert(Math.abs(c.root.top - height * .51 * renderScale) < .01);
        }
        const preview = resolve({ ...input, renderScale: renderScale * .5, state: "expanded" });
        assert(Math.abs(preview.root.width / e.root.width - .5) < .001);
        assert(Math.abs(preview.root.height / e.root.height - .5) < .001);
        assert(Math.abs(preview.root.left - e.root.left * .5) < .001);
        assert(Math.abs(preview.root.top - e.root.top * .5) < .001);
        cases++;
      }
  }
}
assert.equal(normalizeQuickMenuVariant("invalid"), "C");
assert.equal(resolveQuickMenuDirection({ variant: "C", configuredDirection: "auto" }), "up");
assert.equal(resolveQuickMenuDirection({ variant: "A", configuredDirection: "auto" }), "left");
const a = metrics({ variant: "A", layoutWidth: 48, layoutHeight: 8, viewportWidth: 1920, viewportHeight: 1080 });
assert.equal(a.columns, 7); assert.equal(a.rows, 1); assert.equal(a.uniformScale, 1);
assert.equal(a.surfaceWidth, 7 * a.actionHitSize + 6 * a.actionGap + a.toggleHitSize + 2 * a.surfacePadding);
const fallback = metrics({ layoutWidth: NaN, layoutHeight: Infinity, viewportWidth: 0, viewportHeight: -1 });
assert(Number.isFinite(fallback.surfaceWidth) && Number.isFinite(fallback.surfaceHeight));
console.log("quick-menu-metrics-contract: PASS (" + cases + " geometry cases; current horizontal matrix)");
