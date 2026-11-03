"use strict";
// Independent, read-only verification; never deletes or repairs a target.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

async function sha256(file) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

async function verify(auditDirectories) {
  assert(auditDirectories.length, "No empty verification");
  const seen = new Set(), protectedFiles = new Map();
  const result = {
    status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "Only the explicit inventories below; not a full-disk/output completeness claim",
    batches: [], errors: [], logicalBytesRemoved: { C: 0, D: 0 },
    deletedTargets: 0, archivedFiles: 0, archivedBytes: 0, protectedFiles: [],
    baselineFreeBytes: { C: 20344844288, D: 26158444544 },
  };
  for (const directory of auditDirectories) {
    const manifestFile = path.join(directory, "inventory.json");
    const execution = JSON.parse(fs.readFileSync(path.join(directory, "execution.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const batch = { directory, status: execution.status, targets: manifest.targets.length,
      verifiedDeleted: 0, verifiedArchives: 0, discovery: manifest.outputDiscovery || manifest.discovery || null };
    result.batches.push(batch);
    const check = (condition, message) => { if (!condition) result.errors.push({ directory, message }); };
    check(execution.status === "PASS", "Execution is not PASS");
    check(manifest.targets.length > 0 && execution.rows.length === manifest.targets.length, "Empty/incomplete execution");
    check(await sha256(manifestFile) === execution.manifestSha256, "Inventory hash mismatch");
    const targets = new Map(manifest.targets.map(target => [path.resolve(target.path).toLowerCase(), target]));
    check(targets.size === manifest.targets.length, "Duplicate inventory targets");
    const batchBytes = { C: 0, D: 0 };
    for (const row of execution.rows) {
      const key = path.resolve(row.path).toLowerCase();
      const target = targets.get(key);
      check(Boolean(target) && target.bytes === row.bytes && target.kind === row.kind, `Unexpected target: ${row.path}`);
      check(!seen.has(key), `Duplicate across executions: ${row.path}`);
      seen.add(key);
      check(row.status === "DELETED" && !row.error && !fs.existsSync(row.path), `Not verified removed: ${row.path}`);
      if (row.status === "DELETED" && !fs.existsSync(row.path)) {
        batch.verifiedDeleted++; result.deletedTargets++;
        const drive = row.path[0].toUpperCase();
        batchBytes[drive] += row.bytes;
        result.logicalBytesRemoved[drive] += row.bytes;
      }
      if (target?.archiveBeforeDelete) {
        const archive = row.archive;
        check(Boolean(archive?.path) && archive.sha256 === target.sha256, `Missing archive record: ${row.path}`);
        if (archive?.path) {
          const archiveRoot = path.resolve(execution.archiveRoot);
          check(path.resolve(archive.path).startsWith(archiveRoot + path.sep), `Archive outside root: ${archive.path}`);
          try {
            check(fs.statSync(archive.path).size === row.bytes, `Archive length: ${archive.path}`);
            check(await sha256(archive.path) === target.sha256, `Archive SHA mismatch: ${archive.path}`);
            batch.verifiedArchives++; result.archivedFiles++; result.archivedBytes += row.bytes;
          } catch (error) { check(false, `Archive inaccessible: ${archive.path}: ${error.code || error.message}`); }
        }
      }
    }
    for (const drive of ["C", "D"]) check(batchBytes[drive] === execution.logicalBytesRemoved[drive], `${drive} byte total mismatch`);
    for (const entry of manifest.protectedFiles) {
      if (protectedFiles.has(entry.path)) check(protectedFiles.get(entry.path) === entry.sha256, `Inconsistent protected hash: ${entry.path}`);
      protectedFiles.set(entry.path, entry.sha256);
    }
    console.log(JSON.stringify({ verifiedBatch: directory, status: batch.status, targets: batch.targets,
      verifiedDeleted: batch.verifiedDeleted, verifiedArchives: batch.verifiedArchives }));
  }
  for (const [file, expected] of protectedFiles) {
    try {
      const actual = await sha256(file);
      result.protectedFiles.push({ path: file, sha256: actual, unchanged: actual === expected });
      if (actual !== expected) result.errors.push({ message: `Protected file changed: ${file}` });
    } catch (error) { result.errors.push({ message: `Protected file inaccessible: ${file}: ${error.code || error.message}` }); }
  }
  result.status = result.errors.length ? "FAILED" : "PASS";
  result.finishedAt = new Date().toISOString();
  return result;
}

if (require.main === module) {
  const [destination, ...directories] = process.argv.slice(2);
  assert(destination && !fs.existsSync(destination), "Fresh verification output required");
  verify(directories.map(dir => path.resolve(dir))).then(result => {
    fs.writeFileSync(destination, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, deletedTargets: result.deletedTargets,
      archivedFiles: result.archivedFiles, logicalBytesRemoved: result.logicalBytesRemoved, errors: result.errors }));
    if (result.status !== "PASS") process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verify };
