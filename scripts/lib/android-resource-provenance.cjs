"use strict";
const assert = require("node:assert/strict");
// A platform may retain an original when optional optimization fails. Accept
// that only with original-byte provenance and a matching recorded diagnostic.
function verifyResourceProvenance(asset, hash, bytes, windows, original, optimization) {
  assert.equal(hash, asset.hash_sha256);
  assert.equal(bytes, asset.size_bytes);
  assert(windows && original, `Unknown original resource: ${asset.asset_id}`);
  if (hash === windows.final.sha256) {
    assert.equal(bytes, windows.final.bytes);
    return { basis: "WINDOWS_AUDITED_BYTES" };
  }
  assert.equal(hash, original.sha256, `Unproven Android resource: ${asset.asset_id}`);
  assert.equal(bytes, original.bytes);
  const prefix = `Image optimization failed for ${asset.asset_id}: `;
  const warning = optimization?.warnings?.find(value => value.startsWith(prefix));
  assert(warning, `Original fallback lacks optimization diagnostic: ${asset.asset_id}`);
  assert(!optimization.assets.some(row => row.assetId === asset.asset_id && row.status === "optimized"),
    "Resource fallback conflicts with optimization receipt");
  return { basis: "ORIGINAL_BYTES_AFTER_REPORTED_OPTIMIZATION_FAILURE", warning };
}
module.exports = { verifyResourceProvenance };
