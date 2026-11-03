"use strict";
// Preserve large raw evidence on F instead of destroying report references.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const [previousArg, outArg] = process.argv.slice(2);
assert(previousArg && outArg && !fs.existsSync(outArg));
const prior = JSON.parse(fs.readFileSync(previousArg, "utf8"));
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = { status: "INVENTORY_ONLY", startedAt: new Date().toISOString(), root: prior.root,
  targets: [], protectedFiles: prior.protectedFiles, skipped: [], discovery: {} };
const queue = [result.root], end = Date.now() + 120000; let visited = 0;
while (queue.length && Date.now() < end) {
  const dir = queue.pop(); let entries; visited++;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const f = path.join(dir, e.name);
    if (path.relative(result.root, f).split(path.sep).length > 64 || e.name === "recursive-v2-java") {
      result.skipped.push({ path: f, reason: "DEEP_TEST_TREE_REQUIRES_SEPARATE_REVIEW" });
      continue;
    }
    if (e.isDirectory()) {
      if (!/^(node_modules|target|\.gradle|\.git|EBWebView|saves|Local Storage|IndexedDB|Session Storage)$/i.test(e.name)
        && !/checkpoint/i.test(e.name) && !e.name.startsWith("cleanup-audit-")) queue.push(f);
      continue;
    }
    if (!/\.(png|jpe?g|webp|wav|mp3|mp4|webm|etl|vnproj)$/i.test(e.name)) continue;
    // Current run's few screenshots remain beside its reports.
    if (f.startsWith(path.join(result.root, "full-regression-20261017-01") + path.sep)) continue;
    try {
      const s = fs.statSync(f);
      if (s.size < 1024 ** 2) continue;
      result.targets.push({ path: f, kind: "OUTPUT_ARCHIVED_EVIDENCE", bytes: s.size,
        files: 1, modifiedMs: s.mtimeMs, archiveBeforeDelete: true, sha256: hash(f),
        reason: "Large historical raw evidence/test project moved to F; report remains on D" });
    } catch (error) { result.skipped.push({ path: f, reason: String(error.message) }); }
  }
}
result.discovery = { visited, pending: queue.length, completeWithinPrunedScope: queue.length === 0 };
result.logicalBytes = result.targets.reduce((sum, target) => sum + target.bytes, 0);
result.finishedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(outArg), { recursive: true });
fs.writeFileSync(outArg, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ targets: result.targets.length, logicalBytes: result.logicalBytes,
  discovery: result.discovery, skipped: result.skipped.length }));
