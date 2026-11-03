"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function captureRuntimeCandidate(directory) {
  return ["creator-backend.exe", "agentvn-player.exe"].map(name => {
    const file = path.join(directory, name);
    assert(fs.statSync(file).size > 0, `Missing/empty runtime candidate: ${name}`);
    return { name, source: file, sha256: hash(file) };
  });
}
function verifyRuntimeCandidate(directory, expected) {
  return expected.map(candidate => {
    const file = path.join(directory, candidate.name);
    assert(fs.statSync(file).size > 0, `Missing/empty shipped runtime: ${candidate.name}`);
    const actual = hash(file);
    assert.equal(actual, candidate.sha256, `Stale shipped runtime candidate: ${candidate.name}`);
    return { name: candidate.name, path: file, sha256: actual, expectedSha256: candidate.sha256 };
  });
}
module.exports = { captureRuntimeCandidate, verifyRuntimeCandidate };
