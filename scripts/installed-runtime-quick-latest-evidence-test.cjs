"use strict";
const assert = require("node:assert/strict"), { validateDistinctLatest } = require("./installed-runtime-quick-latest-evidence.cjs");
const saved = (n, index) => ({ save_id: `id-${n}`, slot: n, command_index: index, scene_id: "scene",
  created_at: `2026-10-19T01:00:0${n}.000Z` });
const good = { distinct: { oldest: saved(1, 0), latestValid: saved(2, 1), latest: saved(3, 2) },
  listed: [saved(1, 0), saved(2, 1), { ...saved(3, 2), scene_id: "__qa_missing_scene_20261019__" }],
  restored: { command: 1, scene: "scene", text: "MID_ADAPT success" } };
validateDistinctLatest(good);
for (const mutate of [
  c => { c.distinct.oldest.command_index = 1; },
  c => { c.restored.command = 0; },
  c => { c.restored.command = 2; },
  c => { c.distinct.oldest.created_at = c.distinct.latestValid.created_at; },
  c => { c.listed.pop(); },
  c => { c.listed[2].scene_id = "scene"; },
  c => { c.restored.scene = "other"; },
  c => { c.restored.text = "unrelated"; },
]) { const c = structuredClone(good); mutate(c); assert.throws(() => validateDistinctLatest(c)); }
console.log("PASS: 9 latest-valid evidence cases, including rejection of indistinguishable snapshots; not product UI");
