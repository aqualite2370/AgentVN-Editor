"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
function compareBundleMarker(portable, nsis) {
  assert(Buffer.isBuffer(portable) && Buffer.isBuffer(nsis));
  assert.equal(portable.length, nsis.length, "Different PE file sizes");
  const prefix = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_"), p = portable.indexOf(prefix), n = nsis.indexOf(prefix);
  assert(p >= 0 && n === p, "Bundle marker missing or moved");
  assert.equal(portable.indexOf(prefix, p + 1), -1, "Duplicate portable bundle marker");
  assert.equal(nsis.indexOf(prefix, n + 1), -1, "Duplicate NSIS bundle marker");
  const offset = p + prefix.length;
  assert.equal(portable.toString("ascii", offset, offset + 3), "UNK", "Unexpected portable bundle kind");
  assert.equal(nsis.toString("ascii", offset, offset + 3), "NSS", "Unexpected NSIS bundle kind");
  assert.deepEqual(portable.subarray(0, offset), nsis.subarray(0, offset), "Bytes before bundle marker differ");
  assert.deepEqual(portable.subarray(offset + 3), nsis.subarray(offset + 3), "Bytes after bundle marker differ");
  return { status: "PASS", portableSha256: hash(portable), nsisSha256: hash(nsis),
    markerOffset: offset, portableKind: "UNK", nsisKind: "NSS", differentBytes: 3,
    allOtherBytesIdentical: true, mutatedInput: false };
}
module.exports = { compareBundleMarker };
