"use strict";
const assert = require("node:assert/strict");
const { contentSnapshot } = require("./lib/asset-snapshot-content.cjs");
const draft = { id: "p", folders: { a: "folder" }, nodes: [{ id: "n" }], edges: [],
  assets: [{ asset_id: "a", asset_type: "background", metadata: { display_name: "keep", source: "imported",
    data_url: "data:new-bytes", blob_url: "blob:new", filePath: undefined, provider_id: undefined, width: 900 } }] };
const disk = structuredClone(draft);
delete disk.assets[0].metadata.data_url; delete disk.assets[0].metadata.blob_url; delete disk.assets[0].metadata.provider_id;
Object.assign(disk.assets[0].metadata, { backend_asset_path: "p/a-new.svg", filePath: "F:/qa/a-new.svg", url: "http://localhost/a-new" });
const hashes = [{ id: "a", sha256: "a".repeat(64) }];
const baseline = contentSnapshot(draft, hashes);
assert.deepEqual(contentSnapshot(disk, hashes), baseline);
assert.notDeepEqual(contentSnapshot(disk, [{ id: "a", sha256: "b".repeat(64) }]), baseline);
const mutations = [
  s => { s.id = "another-project"; }, s => { s.assets[0].asset_type = "sprite"; },
  s => { s.assets[0].metadata.display_name = "changed"; }, s => { s.assets[0].metadata.source = "generated"; },
  s => { s.assets[0].metadata.provider_id = "old"; }, s => { s.assets[0].metadata.width = 600; },
  s => { s.folders.a = "elsewhere"; }, s => { s.nodes[0].id = "new"; }, s => { s.edges.push({ id: "new" }); },
];
for (const mutate of mutations) { const s = structuredClone(disk); mutate(s); assert.notDeepEqual(contentSnapshot(s, hashes), baseline); }
assert.throws(() => contentSnapshot(disk, []));
assert.throws(() => contentSnapshot(disk, [{ id: "wrong", sha256: "a".repeat(64) }]));
assert.throws(() => contentSnapshot(disk, [{ id: "a", sha256: "unknown" }]));
console.log(JSON.stringify({ status: "PASS", transportOnlyEquivalence: 1, changedMeaningOrBytesDetected: 10,
  invalidEvidenceRejected: 3, productLaunches: 0 }));
