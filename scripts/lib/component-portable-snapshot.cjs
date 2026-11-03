"use strict";
const assert = require("node:assert/strict");
// Portable import explicitly materializes these two verifiable descriptors.
// Do not ignore a mismatching path/hash, or discard arbitrary metadata fields.
function normalizePortableSnapshot(value) {
  const copy = structuredClone(value);
  for (const a of copy.assets) {
    if (Object.hasOwn(a.metadata, "path")) {
      assert.equal(a.metadata.path, a.metadata.project_path); delete a.metadata.path;
    }
    if (Object.hasOwn(a.metadata, "hash_sha256")) {
      assert.equal(a.metadata.hash_sha256, a.observedContentSha256); delete a.metadata.hash_sha256;
    }
  }
  return copy;
}
module.exports = { normalizePortableSnapshot };
