"use strict";

// Calibrate the paint detector against real captured bad and good Editor frames.
// Does not mutate screenshots, reports, projects or product rendering.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inspectGuiDialogPng, assertGuiDialogPaint } = require("./lib/gui-dialog-paint.cjs");

async function main() {
  const [geometryPath, goodPng, badPng] = process.argv.slice(2);
  assert(geometryPath && goodPng && badPng, "Usage: node scripts/gui-dialog-paint-evidence-test.cjs geometry.json good.png bad.png");
  const geometry = JSON.parse(fs.readFileSync(path.resolve(geometryPath), "utf8"));
  // Existing light-theme evidence predates the header pixel check.
  const dom = { ...geometry, ink: geometry.ink ?? [31, 21, 24, 255] };
  const good = await inspectGuiDialogPng(dom, fs.readFileSync(path.resolve(goodPng)));
  const bad = await inspectGuiDialogPng(dom, fs.readFileSync(path.resolve(badPng)));
  assertGuiDialogPaint(good);
  assert.throws(() => assertGuiDialogPaint(bad), /missing painted theme surface/);
  assert(bad.headerInkPixels < good.headerInkPixels / 10, "Captured bad frame must also expose the missing header");
  console.log(JSON.stringify({ status: "PASS", scope: "paint-detector calibration, not product acceptance",
    good: { patches: good.patches, headerInkPixels: good.headerInkPixels },
    bad: { patches: bad.patches, headerInkPixels: bad.headerInkPixels } }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
