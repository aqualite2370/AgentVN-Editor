"use strict";
const assert = require("node:assert/strict");
const { verifyResourceProvenance: verify } = require("./lib/android-resource-provenance.cjs");
const original = { sha256: "original", bytes: 100 };
const windows = { final: { sha256: "optimized", bytes: 60 } };
const receipt = { warnings: ["Image optimization failed for test: Input file is missing"], assets: [] };
const asset = { asset_id: "test", hash_sha256: "original", size_bytes: 100 };
assert.equal(verify(asset, "original", 100, windows, original, receipt).basis,
  "ORIGINAL_BYTES_AFTER_REPORTED_OPTIMIZATION_FAILURE");
assert.equal(verify({ ...asset, hash_sha256: "optimized", size_bytes: 60 },
  "optimized", 60, windows, original, receipt).basis, "WINDOWS_AUDITED_BYTES");
assert.throws(() => verify(asset, "foreign", 100, windows, original, receipt));
assert.throws(() => verify({ ...asset, hash_sha256: "foreign" }, "foreign", 100, windows, original, receipt));
assert.throws(() => verify(asset, "original", 100, windows, original, { warnings: [], assets: [] }));
assert.throws(() => verify(asset, "original", 100, windows, original, {
  ...receipt, assets: [{ assetId: "test", status: "optimized" }],
}));
assert.throws(() => verify(asset, "original", 100, windows, { ...original, bytes: 99 }, receipt));
assert.throws(() => verify(asset, "original", 100, undefined, original, receipt));
console.log("PASS: 2 accepted provenance cases and 6 rejection cases");
