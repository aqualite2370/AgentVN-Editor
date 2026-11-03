"use strict";
// Read-only audit of the *post-editor* state. The build-script receipt alone
// cannot prove that metadata survived a later native-host cleanup correctly.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function audit(metadata) {
  const artifacts = [];
  for (const key of ["apk", "sourceCartridge", "prepackageLayout"]) {
    const entry = metadata[key];
    if (entry?.present === false) continue;
    assert(entry && path.isAbsolute(entry.path) && /^[a-f0-9]{64}$/i.test(entry.sha256),
      `Incomplete original artifact evidence: ${key}`);
    const exists = fs.existsSync(entry.path);
    const currentHash = exists ? sha256(fs.readFileSync(entry.path)) : null;
    const actualCleaned = !exists || currentHash !== entry.sha256;
    const valid = key === "apk" ? exists && !actualCleaned && entry.cleaned === false
      : entry.cleaned === actualCleaned;
    artifacts.push({ kind: key, path: entry.path, retainedSha256: entry.sha256,
      exists, currentSha256: currentHash, reportedCleaned: entry.cleaned,
      observedCleaned: actualCleaned, status: valid ? "PASS" : "FAILED" });
  }
  assert.equal(artifacts.length >= 2, true, "Cannot pass an empty artifact audit");
  return { status: artifacts.every(item => item.status === "PASS") ? "PASS" : "FAILED", artifacts };
}
if (require.main === module) {
  assert.equal(process.argv.length, 4, "node script <apk.acceptance.json> <fresh-report-directory>");
  const [metadataFile, out] = process.argv.slice(2).map(p => path.resolve(p));
  assert(!fs.existsSync(out), "Preserve historical audit evidence");
  const bytes = fs.readFileSync(metadataFile), metadata = JSON.parse(bytes.toString("utf8"));
  const result = { ...audit(metadata), checkedAt: new Date().toISOString(),
    scope: "actual-installed-editor-post-build-artifact-cleanup",
    metadata: { path: metadataFile, sha256: sha256(bytes), recordedAt: metadata.recordedAt },
    originalMetadataModified: false };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "PASS") process.exitCode = 1;
}
module.exports = { audit };
