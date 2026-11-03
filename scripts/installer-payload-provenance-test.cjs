"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { captureRuntimeCandidate, verifyRuntimeCandidate } = require("./lib/installer-payload-provenance.cjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "AgentVN-installer-provenance-"));
const source = path.join(temporary, "当前 候选");
const shipped = path.join(temporary, "安装 包");
try {
  fs.mkdirSync(source); fs.mkdirSync(shipped);
  for (const name of ["creator-backend.exe", "agentvn-player.exe"]) {
    fs.writeFileSync(path.join(source, name), Buffer.from(`MZ new candidate ${name}`));
    fs.copyFileSync(path.join(source, name), path.join(shipped, name));
  }
  const candidate = captureRuntimeCandidate(source);
  const result = verifyRuntimeCandidate(shipped, candidate);
  assert.equal(result.length, 2);
  assert(result.every(item => item.sha256 === item.expectedSha256));
  fs.writeFileSync(path.join(shipped, "creator-backend.exe"), "MZ old same-version sidecar");
  assert.throws(() => verifyRuntimeCandidate(shipped, candidate), /stale.*creator-backend/i,
    "An old same-version backend must not produce installer PASS");
  fs.copyFileSync(path.join(source, "creator-backend.exe"), path.join(shipped, "creator-backend.exe"));
  fs.writeFileSync(path.join(shipped, "agentvn-player.exe"), "MZ old same-version player");
  assert.throws(() => verifyRuntimeCandidate(shipped, candidate), /stale.*agentvn-player/i);
  fs.unlinkSync(path.join(shipped, "agentvn-player.exe"));
  assert.throws(() => verifyRuntimeCandidate(shipped, candidate), /ENOENT/);
  console.log("installer-payload-provenance-test: PASS (exact bytes, stale sidecar/player, missing, Chinese paths)");
} finally {
  assert(path.dirname(temporary) === os.tmpdir(), "Cleanup is limited to the owned temporary directory");
  fs.rmSync(temporary, { recursive: true });
}
