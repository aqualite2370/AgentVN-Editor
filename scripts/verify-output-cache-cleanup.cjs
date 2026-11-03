"use strict";
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { ROOT, inside, allowed } = require("./output-cache-inventory.cjs");
assert.equal(process.argv.length, 4, "node verify-output-cache-cleanup.cjs <audit-dir> <fresh-report>");
const dir = path.resolve(process.argv[2]), file = path.resolve(process.argv[3]);
assert(inside(ROOT, dir) && inside(dir, file) && !fs.existsSync(file));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const executionFile = path.join(dir, "execution.json"), run = read(executionFile);
assert.equal(run.status, "PASS");
assert(inside(dir, run.manifest));
assert.equal(sha(run.manifest), run.manifestSha256);
const inventory = read(run.manifest);
assert.equal(inventory.root, ROOT);
assert(inventory.targets.length > 0);
assert.equal(run.rows.length, inventory.targets.length);
const known = new Map(inventory.targets.map(t => [t.path, t]));
let bytes = 0, removed = 0, skipped = 0;
for (const row of run.rows) {
  assert(known.has(row.path) && allowed(ROOT, row.path), "Unexpected cleanup target");
  assert.equal(row.logicalBytes, known.get(row.path).bytes);
  if (row.status === "DELETED") {
    assert(!fs.existsSync(row.path), `Deleted cache remains: ${row.path}`);
    bytes += row.logicalBytes; removed++;
  } else { assert.equal(row.status, "SKIPPED_ACTIVE_PROFILE"); skipped++; }
}
assert.equal(bytes, run.logicalBytesRemoved);
for (const p of inventory.protectedFiles) assert.equal(sha(p.path), p.sha256, `Protected file changed: ${p.path}`);
const report = {
  status: "PASS", verifiedAt: new Date().toISOString(),
  execution: { path: executionFile, sha256: sha(executionFile) },
  inventory: { path: run.manifest, sha256: sha(run.manifest) },
  checks: ["Exact manifest identity", "Every deletion within approved cache scope",
    "Removed targets absent", "Logical byte totals consistent", "Protected source/artifact/evidence hashes unchanged"],
  deletedDirectories: removed, skippedActiveDirectories: skipped,
  logicalBytesRemoved: bytes, observedFreeBytesDelta: run.observedFreeBytesDelta,
  freeSpaceCaveat: "Drive free-space delta is observed, not guaranteed exclusive attribution while other apps run",
  protectedFilesVerified: inventory.protectedFiles.length,
  userDataDeleted: false, duplicateBuildCopiesDeleted: false,
  recovery: run.recovery
};
fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report));
