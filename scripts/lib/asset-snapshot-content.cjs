"use strict";
const assert = require("node:assert/strict");
// Autosave may materialize inline bytes into backend-owned files. Compare the
// independently read content hashes, not the transient transport addresses.
const transportFields = new Set(["data_url", "blob_url", "backend_asset_path", "filePath", "url", "bytes"]);
function contentSnapshot(state, content) {
  assert.equal(content.length, state.assets.length);
  assert.equal(new Set(content.map(a => a.id)).size, content.length);
  const value = { ...state, assets: state.assets.map(a => {
    const observed = content.find(c => c.id === a.asset_id); assert(observed);
    assert.match(observed.sha256, /^[0-9a-f]{64}$/);
    return { ...a, metadata: Object.fromEntries(Object.entries(a.metadata).filter(([key]) => !transportFields.has(key))),
      observedContentSha256: observed.sha256 };
  }) };
  // JSON persistence omits undefined properties; no meaningful field is dropped.
  return JSON.parse(JSON.stringify(value));
}
module.exports = { contentSnapshot };
