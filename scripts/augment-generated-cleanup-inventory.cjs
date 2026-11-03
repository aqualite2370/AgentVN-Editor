"use strict";
// Extend, never rewrite the original read-only inventory.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const [previousArg, outArg] = process.argv.slice(2);
assert(previousArg && outArg && !fs.existsSync(outArg));
const manifest = JSON.parse(fs.readFileSync(previousArg, "utf8"));
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const temp = "C:/Users/1/AppData/Local/Temp";
const seeds = [
  ["output/e5-complete-installed-20261014-01/agent-flow-01/owned-launch-2/installed-processes.json", 100380],
  ["output/novel-card-crash-20261017-01/owned-launch-3/installed-processes.json", 87952],
];
manifest.runtimeFingerprintSources = [];
const known = new Set(manifest.targets.map(t => t.path.toLowerCase()));
function countTree(root) {
  const queue = [root]; let bytes = 0, files = 0;
  while (queue.length) {
    const dir = queue.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name), s = fs.lstatSync(f);
      assert(!s.isSymbolicLink(), "Linked runtime");
      if (s.isDirectory()) queue.push(f); else { bytes += s.size; files++; }
    }
  }
  return { bytes, files };
}
for (const [evidence, pid] of seeds) {
  const record = JSON.parse(fs.readFileSync(evidence, "utf8"));
  assert.equal(record.backendPid, pid);
  const seed = path.join(temp, `_MEI${pid}2`);
  const names = ["base_library.zip", "python311.dll", "sqlite_vec/vec0.dll"];
  const fingerprint = names.map(rel => ({ rel, sha256: hash(path.join(seed, rel)) }));
  manifest.runtimeFingerprintSources.push({ evidence: path.resolve(evidence), backendPid: pid,
    seed, fingerprint });
  manifest.protectedFiles.push({ path: path.resolve(evidence), sha256: hash(evidence) });
  for (const e of fs.readdirSync(temp, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^_MEI\d+$/.test(e.name)) continue;
    const dir = path.join(temp, e.name);
    if (known.has(dir.toLowerCase())) continue;
    try {
      if (!fingerprint.every(f => fs.existsSync(path.join(dir, f.rel))
        && hash(path.join(dir, f.rel)) === f.sha256)) continue;
      const count = countTree(dir);
      manifest.targets.push({ path: dir, kind: "C_BACKEND_RUNTIME", ...count,
        reason: "Orphan runtime matches a historically recorded AgentVN backend",
        runtimeFingerprint: fingerprint, provenance: path.resolve(evidence) });
      known.add(dir.toLowerCase());
    } catch (error) { manifest.skipped.push({ path: dir, reason: String(error.message) }); }
  }
}
const artifacts = "D:/AgentVN/output/full-regression-20261017-01/checkpoint/artifacts";
const queue = [artifacts];
while (queue.length) {
  const dir = queue.pop();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name), s = fs.lstatSync(f);
    assert(!s.isSymbolicLink());
    if (s.isDirectory()) queue.push(f);
    else if (s.size >= 1024 ** 2 && !known.has(f.toLowerCase())) {
      manifest.targets.push({ path: f, kind: "OUTPUT_GENERATED_FILE", bytes: s.size,
        files: 1, modifiedMs: s.mtimeMs, archiveBeforeDelete: true, sha256: hash(f),
        reason: "Recovery binary archived and byte-verified on F before clearing D" });
    }
  }
}
manifest.previousInventory = path.resolve(previousArg);
manifest.augmentedAt = new Date().toISOString();
manifest.logicalBytes = manifest.targets.reduce((s, t) => s + t.bytes, 0);
manifest.logicalBytesByDrive = Object.fromEntries(["C", "D"].map(d => [d,
  manifest.targets.filter(t => t.path[0].toUpperCase() === d).reduce((s, t) => s + t.bytes, 0)]));
fs.mkdirSync(path.dirname(outArg), { recursive: true });
fs.writeFileSync(outArg, JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ targets: manifest.targets.length, bytesByDrive: manifest.logicalBytesByDrive,
  archives: manifest.targets.filter(t => t.archiveBeforeDelete).length }));
