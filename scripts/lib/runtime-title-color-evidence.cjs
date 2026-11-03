"use strict";
// Schema/behavior validation only. The publishing caller must additionally
// verify current source and served production bytes; this does not run a game.
const assert = require("node:assert/strict");
const { desktopViewports } = require("./current-acceptance-viewports.cjs");
function validateTitleColorEvidence(evidence, legacy) {
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.scope, "PRODUCTION_RUNTIME_TITLE_COLOR_NOT_INSTALLED_OR_ANDROID_ACCEPTANCE");
  assert.equal(evidence.smoke, false, "Smoke is not full title coverage");
  assert.equal(evidence.legacy, legacy);
  assert.equal(evidence.expectedCaseCount, 60);
  assert.equal(evidence.cases.length, 60);
  assert(evidence.cleanup.browserClosed && evidence.cleanup.serverStopped);
  assert(evidence.sources.length > 0 && evidence.served.some(row => row.relative.endsWith(".js")));
  if (legacy) assert(evidence.browser.startsWith("90."), "Must exercise the actual legacy engine");
  const expected = new Set();
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2])
    for (const reduced of [false, true]) for (const kind of ["absent", "default", "token", "component", "renpy"])
      expected.add(`${width}x${height}/${dpr}/${reduced}/${kind}`);
  for (const row of evidence.cases) {
    const key = `${row.viewport.width}x${row.viewport.height}/${row.dpr}/${row.reduced}/${row.kind}`;
    assert(expected.delete(key), `Unexpected or duplicate title matrix row: ${key}`);
    assert.equal(row.status, "PASS");
    assert.equal(row.flow, "TITLE_COLOR_SETTINGS_RETURN_AND_START_PASS");
    assert.equal(row.errors.length, 0); assert.equal(row.blockedRequests.length, 0);
    assert(Number.isFinite(row.contrast) && row.contrast >= 3, "Title contrast must be measured and sufficient");
    for (const sample of [row.before, row.afterCapture, row.afterReturn])
      assert.deepEqual(sample.actual, { ...row.viewport, dpr: row.dpr, reduced: row.reduced },
        "Actual title viewport/DPR/media is missing or incorrect");
    const rect = row.before.rect;
    assert(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
      && rect.x + rect.width <= row.viewport.width + 1
      && rect.y + rect.height <= row.viewport.height + 1 && row.before.overflow === false);
    const colors = { token: "rgb(157, 227, 197)", component: "rgb(255, 194, 120)" };
    if (colors[row.kind]) assert.equal(row.before.color, colors[row.kind], "Explicit author color changed");
    assert.equal(row.afterReturn.color, row.before.color, "Return flow changed title color");
  }
  assert.equal(expected.size, 0, "Missing title combinations");
}
module.exports = { validateTitleColorEvidence };
