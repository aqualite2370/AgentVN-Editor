"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { assertRestoredNarrativeState } = require("./lib/narrative-restoration-state.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/";
const original = JSON.parse(fs.readFileSync(`${base}dev-narrative-20261024-03/player.json`));
const observation = JSON.parse(fs.readFileSync(`${base}dev-narrative-20261024-04/observation.json`));
const cell = original.cells.find(c => c.name === "2560x1440-dpr1-normal-renpy");
const expected = cell.saved.find(s => s.name === "voice_nvl").interior;
const states = observation.traces.flatMap(t => t.frames).map(f => ({
  scene: f.scene, command: Number(f.command), mode: "nvl", page: Number(f.page), pages: Number(f.pages),
  text: f.text, font: parseFloat(f.lines.at(-1).textStyle.fontSize),
  rect: f.panel, region: f.region, glyphs: f.glyphs, overflow: f.overflow,
  nvl: f.lines.map(n => ({ text: n.text, font: parseFloat(n.textStyle.fontSize), rect: n.rect })),
}));
assert.equal(states.length, 364);
for (const state of states) assertRestoredNarrativeState(state, expected, cell.viewport);
// Real observations reproduce the assertion's overreach: unchanged restored
// text/font and safe glyphs, but a non-persisted fractional rectangle differs.
assert.throws(() => assert.deepEqual(states[0].nvl, expected.nvl));
const corruptions = [
  s => { s.text += "错误"; }, s => { s.font = 11; }, s => { s.page++; },
  s => { s.pages++; }, s => { s.scene = "wrong"; }, s => { s.command++; },
  s => { s.nvl[0].text += "重复"; }, s => { s.nvl[0].font++; },
  s => { s.glyphs[0].bottom = s.region.bottom + 3; },
  s => { s.glyphs = []; }, s => { s.rect.right = 2562; },
  s => { s.region = null; }, s => { s.overflow = 2; },
];
for (const mutate of corruptions) {
  const state = structuredClone(states[0]); mutate(state);
  assert.throws(() => assertRestoredNarrativeState(state, expected, cell.viewport));
}
console.log(JSON.stringify({ status: "PASS", scope: "REAL_TRACE_ASSERTION_REGRESSION_NOT_NEW_PRODUCT_RUN",
  actualFrames: states.length, corruptedStatesRejected: corruptions.length,
  originalStrictRectangleComparisonStillFails: true }));
