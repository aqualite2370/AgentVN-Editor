"use strict";
// Read-only pixel evidence. Computed white text and correct PNG dimensions
// alone do not prove that a separate global curtain has actually cleared.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const sharp = require("../GameCli_framework/node_modules/sharp");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });

async function textPixels(screenshot, rendered, expected) {
  assert.equal(sha(screenshot.path), screenshot.sha256);
  assert.deepEqual(screenshot.before, screenshot.after);
  const bytes = fs.readFileSync(screenshot.path), viewport = screenshot.before;
  assert.equal(viewport.width, expected.width); assert.equal(viewport.height, expected.height);
  assert.equal(viewport.reduced, expected.reduced);
  assert(Math.abs(viewport.dpr - expected.dpr) <= 1e-6, "Actual DPR differs from the explicit requested display");
  const width = expected.width * expected.dpr, height = expected.height * expected.dpr;
  assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  const color = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rendered.color);
  assert(color, `Unsupported observed color: ${rendered.color}`);
  const target = color.slice(1).map(Number);
  assert(Math.max(...target) >= 180, "This fixture must contain visibly light text");
  assert(rendered.text && rendered.textRects.length > 0);
  const regions = [];
  for (const rect of rendered.textRects) {
    const left = Math.ceil(rect.left * viewport.dpr), top = Math.ceil(rect.top * viewport.dpr);
    const right = Math.floor(rect.right * viewport.dpr), bottom = Math.floor(rect.bottom * viewport.dpr);
    assert(left >= 0 && top >= 0 && right <= width && bottom <= height && right > left && bottom > top);
    const region = { left, top, width: right - left, height: bottom - top };
    const { data, info } = await sharp(bytes).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let matchingPixels = 0, maxChannel = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      maxChannel = Math.max(maxChannel, data[i], data[i + 1], data[i + 2]);
      if (target.every((value, c) => Math.abs(value - data[i + c]) <= 40)) matchingPixels++;
    }
    const pixelCount = region.width * region.height;
    regions.push({ region, pixelCount, matchingPixels, fraction: matchingPixels / pixelCount,
      maxChannel, visibleText: matchingPixels >= Math.max(20, pixelCount * .005) });
  }
  return { target, regions, visibleText: regions.every(region => region.visibleText) };
}

async function audit(file, output) {
  assert(path.resolve(output).startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
  assert(!fs.existsSync(output));
  const source = read(file);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: describe(file),
    scope: "ARCHIVED_PIXEL_READABILITY_ONLY_NOT_ALL_FUNCTIONAL_OR_NEW_RUNTIME_ACCEPTANCE",
    cases: [], productStarts: 0, productChanges: 0, modelRequests: 0 };
  try {
    assert.equal(source.status, "PASS"); assert(source.finishedAt && !source.cleanupError && !source.error);
    assert.equal(source.cells.length, 24);
    assert(source.cells.every(cell => cell.status === "PASS"));
    const matrix = ["agentvn", "renpy"].flatMap(layout => [1920, 2560, 3840].flatMap(width =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
    for (const display of matrix)
      assert.equal(source.cells.filter(cell => JSON.stringify(cell.display) === JSON.stringify(display)).length, 1);
    const supplemental = Array.isArray(source.paintSamples);
    const samples = supplemental ? source.paintSamples : source.cells.map(cell => {
      const screenshots = source.screenshots.filter(s => path.basename(s.path) === `${cell.display.layout}-${cell.label}-display.png`);
      assert.equal(screenshots.length, 1);
      return { display: cell.display, label: cell.label, stage: "contrast",
        rendered: cell.checks.find(check => check.name === "display").detail.contrast, screenshot: screenshots[0] };
    });
    assert.equal(samples.length, supplemental ? 120 : 24);
    for (const cell of source.cells) {
      const stages = samples.filter(sample => sample.label === cell.label).map(sample => sample.stage);
      assert.deepEqual(stages, supplemental ? ["before", "font", "line", "contrast", "restored"] : ["contrast"]);
    }
    for (const sample of samples) {
      const actual = await textPixels(sample.screenshot, sample.rendered, sample.display);
      const row = { label: sample.label, stage: sample.stage, screenshot: sample.screenshot,
        pixels: actual, status: actual.visibleText ? "PASS" : "FAILED" };
      if (supplemental) {
        assert.equal(sample.readiness.screen, "playing"); assert.equal(sample.readiness.phase, "idle");
        assert.equal(sample.readiness.blackout, false); assert.equal(sample.readiness.boot, false);
        assert.deepEqual(actual, sample.pixels, "Recomputed image pixels differ from recorded evidence");
      }
      report.cases.push(row);
    }
    assert(report.cases.every(row => row.status === "PASS"), "Some actual glyph regions are obscured or too dim");
    assert.equal(sha(file), report.input.sha256); report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  return report;
}

module.exports = { textPixels, audit };
if (require.main === module) {
  const [file, output] = process.argv.slice(2); assert(file && output && process.argv.length === 4);
  audit(file, output).then(report => {
    console.log(JSON.stringify({ status: report.status, output, samples: report.cases.length,
      dimSamples: report.cases.filter(c => c.status === "FAILED").length, error: report.error }));
    if (report.status !== "PASS") process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
