"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateSettings } = require("./lib/runtime-settings-evidence.cjs");
const source = "D:/AgentVN/output/installed-runtime-settings-20261018-01/runtime-01/report.json";
const r = JSON.parse(fs.readFileSync(source, "utf8").replace(/^\uFEFF/, ""));
validateSettings(r);
const invalid = [
  r => { r.status = "RUNNING"; }, r => { r.finishedAt = null; }, r => { r.cleanupError = "missing"; },
  r => { r.scope = "COMPLETE_PASS"; }, r => { r.productChanges = 1; }, r => { r.realModelRequests = 1; },
  r => { r.checks = []; }, r => { r.checks[0].status = "FAILED"; },
  r => { r.inventory.groups[0].controls.pop(); }, r => { r.checks[0].detail.controls[0].value = 9; },
  r => { r.checks[0].detail.prefs.rollbackSideMobile = true; },
  r => { r.checks.find(c => c.name.startsWith("Switching the same")).detail.otherAfter.volumeBgm = .99; },
  r => { r.checks.find(c => c.name.startsWith("Actual new native process")).detail.prefs.fontScale = 2; },
  r => { r.matrix = []; }, r => { r.matrix[1] = r.matrix[0]; },
  r => { r.matrix[0].categories.pop(); }, r => { r.matrix[0].categories[0].geometry.controls[0].hit = false; },
  r => { r.matrix[0].categories[0].geometry.controls[0].clipped = true; },
  r => { r.matrix[0].categories[0].geometry.overflow = 60; },
  r => { r.matrix[0].categories[0].geometry.panel.width = r.matrix[0].width; },
  r => { r.matrix[0].categories[0].geometry.controls[1].rect = r.matrix[0].categories[0].geometry.controls[0].rect; },
  r => { r.matrix[0].categories[0].icons[0].iconCss = 2; },
  r => { r.launches.pop(); }, r => { r.launches[0].cleanup.method = "FORCE_KILL"; },
  r => { r.interactions[0].inputs[0].trusted = false; },
  r => { r.screenshots.pop(); }, r => { r.screenshots[0].png.width = 1; },
  r => { r.pageErrors.push("React error"); },
];
for (const mutate of invalid) {
  const copy = structuredClone(r); mutate(copy); assert.throws(() => validateSettings(copy));
}
console.log(`PASS settings evidence oracle: historical baseline, ${invalid.length} invalid variants rejected; no product launches`);
