"use strict";
const assert = require("node:assert/strict");
const { normalizePortableSnapshot: norm } = require("./lib/component-portable-snapshot.cjs");
const original = { id: "qa", settings: { mode: "renpy" }, nodes: [{ id: "node1" }], assets: [{
  asset_id: "a1", asset_type: "ui", observedContentSha256: "a".repeat(64),
  metadata: { project_path: "assets/ui/红图.png", display_name: "红图", tags: ["custom_component"] },
}] };
const imported = structuredClone(original);
imported.assets[0].metadata.path = "assets/ui/红图.png";
imported.assets[0].metadata.hash_sha256 = "a".repeat(64);
assert.deepEqual(norm(imported), original); assert.deepEqual(norm(original), original);
const invalid = [
  r => { r.assets[0].metadata.path = "../outside"; },
  r => { r.assets[0].metadata.hash_sha256 = "b".repeat(64); },
  r => { r.assets[0].observedContentSha256 = "b".repeat(64); },
  r => { r.assets[0].metadata.project_path = "assets/ui/other.png"; },
  r => { r.assets[0].metadata.display_name = "changed"; },
  r => { r.assets[0].metadata.tags.push("unexpected"); },
  r => { r.settings.mode = "agentvn"; },
  r => { r.nodes[0].id = "changed"; },
  r => { r.assets[0].asset_id = "changed"; },
];
for (const mutate of invalid) {
  const bad = structuredClone(imported); mutate(bad);
  assert.throws(() => assert.deepEqual(norm(bad), original));
}
console.log(JSON.stringify({ status: "PASS", exactDescriptorEquivalence: 1, meaningfulChangesRejected: invalid.length, launches: 0 }));
