"use strict";
const assert = require("node:assert/strict");
function validateDistinctLatest(cell) {
  const { oldest, latestValid, latest } = cell.distinct;
  assert.equal(new Set([oldest.save_id, latestValid.save_id, latest.save_id]).size, 3);
  assert.equal(new Set([oldest.slot, latestValid.slot, latest.slot]).size, 3);
  assert.equal(new Set([oldest.command_index, latestValid.command_index, latest.command_index]).size, 3,
    "Indistinguishable valid snapshots cannot prove latest-valid selection");
  assert(Date.parse(oldest.created_at) < Date.parse(latestValid.created_at));
  assert(Date.parse(latestValid.created_at) < Date.parse(latest.created_at));
  assert.equal(cell.listed.length, 3);
  assert(cell.listed.some(s => s.save_id === latest.save_id && s.scene_id === "__qa_missing_scene_20261019__"));
  assert(cell.listed.some(s => s.save_id === latestValid.save_id && s.command_index === latestValid.command_index));
  assert.equal(cell.restored.command, latestValid.command_index);
  assert.notEqual(cell.restored.command, oldest.command_index);
  assert.notEqual(cell.restored.command, latest.command_index);
  assert.equal(cell.restored.scene, latestValid.scene_id);
  assert(cell.restored.text.includes("MID_ADAPT"));
  return { oldestCommand: oldest.command_index, newestValidCommand: latestValid.command_index,
    invalidNewestCommand: latest.command_index, actualRestoredCommand: cell.restored.command };
}
module.exports = { validateDistinctLatest };
