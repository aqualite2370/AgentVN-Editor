"use strict";
const fs = require("node:fs"), crypto = require("node:crypto"), assert = require("node:assert/strict");
// Hash artifacts without allocating a Buffer proportional to file size.
function hashFileSha256(file, chunkBytes = 1024 * 1024) {
  assert(Number.isSafeInteger(chunkBytes) && chunkBytes >= 4096 && chunkBytes <= 4 * 1024 * 1024);
  const fd = fs.openSync(file, "r"), hash = crypto.createHash("sha256"), buffer = Buffer.allocUnsafe(chunkBytes);
  try {
    assert(fs.fstatSync(fd).isFile(), "Regular artifact file required");
    for (;;) {
      const size = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!size) break;
      hash.update(buffer.subarray(0, size));
    }
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}
module.exports = { hashFileSha256 };
