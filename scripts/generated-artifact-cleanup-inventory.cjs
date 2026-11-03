"use strict";
// Read-only inventory. Native PowerShell consumes exact validated targets.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const [outArg, mode = "all", pendingInventoryArg] = process.argv.slice(2);
assert(["all", "output-only"].includes(mode));
const root = path.resolve("D:/AgentVN/output"), temp = "C:/Users/1/AppData/Local/Temp";
const out = path.resolve(outArg || "");
assert(out.startsWith(root + path.sep) && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "INVENTORY_ONLY", startedAt: new Date().toISOString(), root,
  targets: [], skipped: [], protectedFiles: [], visitedFiles: 0, visitedDirectories: 0 };
function measure(dir, deadline) {
  let files = 0, bytes = 0, queue = [dir];
  while (queue.length) {
    assert(Date.now() < deadline, "Measurement deadline");
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name), s = fs.lstatSync(file);
      assert(!s.isSymbolicLink(), "Linked subtree");
      if (s.isDirectory()) queue.push(file);
      else { bytes += s.size; files++; }
    }
  }
  return { files, bytes };
}
function directoryTarget(dir, reason, kind, deadline) {
  try {
    const s = fs.lstatSync(dir);
    assert(s.isDirectory() && !s.isSymbolicLink());
    const count = measure(dir, deadline);
    report.targets.push({ path: path.resolve(dir), kind, reason, ...count });
  } catch (error) { report.skipped.push({ path: dir, reason: String(error.message) }); }
}
const candidate = path.join(root, "full-regression-20261017-01/candidate-02/manifest.json");
const current = JSON.parse(fs.readFileSync(candidate, "utf8"));
for (const artifact of current.artifacts) {
  report.protectedFiles.push({ path: artifact.source.path, sha256: hash(artifact.source.path) });
}
for (const file of [
  "D:/AgentVN/AGENTS.md",
  "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db",
  "D:/AgentVN/output/full-regression-20261017-01/checkpoint/manifest.json",
  candidate,
]) if (fs.existsSync(file))
  report.protectedFiles.push({ path: path.resolve(file), sha256: hash(file) });

// Output policy: retain reports, screenshots, source checkpoints, DBs and saves.
// Remove reproducible binary payloads/dependency/compiler trees; archive current recovery artifacts.
const pendingInventory = pendingInventoryArg
  ? JSON.parse(fs.readFileSync(path.resolve(pendingInventoryArg), "utf8")) : null;
if (pendingInventory) {
  assert(mode === "output-only" && pendingInventory.root === root);
  assert(Array.isArray(pendingInventory.outputDiscovery.pendingPaths));
}
const pendingPaths = pendingInventory
  ? pendingInventory.outputDiscovery.pendingPaths.filter(file => {
    const relative = path.relative(root, path.resolve(file));
    if (relative.split(path.sep).length > 64 || /(^|[\\/])recursive-v2-java([\\/]|$)/i.test(relative)) {
      report.excludedDeepContinuationRoots = (report.excludedDeepContinuationRoots || 0) + 1;
      return false;
    }
    return true;
  }).map(file => {
    const absolute = path.resolve(file);
    assert(absolute.startsWith(root + path.sep), "Continuation must remain inside output");
    assert(!fs.lstatSync(absolute).isSymbolicLink(), "No linked continuation root");
    return absolute;
  }) : [root];
report.continuesInventory = pendingInventoryArg ? path.resolve(pendingInventoryArg) : null;
const deadline = Date.now() + 90000, queue = [...new Set(pendingPaths)], topTotals = {};
while (queue.length && Date.now() < deadline && report.visitedFiles < 600000) {
  const dir = queue.pop();
  report.visitedDirectories++;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) { report.skipped.push({ path: dir, reason: error.code }); continue; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (file === out || entry.name.startsWith("cleanup-audit-")) continue;
    const rel = path.relative(root, file), parts = rel.split(path.sep);
    if (parts.length > 64 || entry.name === "recursive-v2-java") {
      report.skipped.push({ path: file, reason: "DEEP_TEST_TREE_REQUIRES_SEPARATE_REVIEW" });
      continue;
    }
    const protectedCheckpoint = parts.some(part => /checkpoint/i.test(part))
      && !rel.startsWith("full-regression-20261017-01" + path.sep + "checkpoint" + path.sep + "artifacts" + path.sep);
    if (protectedCheckpoint) continue;
    let s;
    try { s = fs.lstatSync(file); } catch { continue; }
    if (s.isSymbolicLink()) { report.skipped.push({ path: file, reason: "LINK_NOT_FOLLOWED" }); continue; }
    if (s.isDirectory()) {
      if ([".git", "saves", "Local Storage", "IndexedDB", "Session Storage"].includes(entry.name)) continue;
      if (["target", "node_modules", ".gradle"].includes(entry.name)) {
        directoryTarget(file, "Reconstructable test dependency/compiler cache", "OUTPUT_CACHE_DIRECTORY", deadline);
      } else queue.push(file);
      continue;
    }
    report.visitedFiles++;
    topTotals[parts[0]] = (topTotals[parts[0]] || 0) + s.size;
    const binary = /\.(exe|msi|apk|aab|dll|pdb|rlib|rmeta|obj|o|a|lib|so|jar|dex|pak|avnenv|vncart)$/i.test(entry.name);
    const archive = /\.zip$/i.test(entry.name)
      && !/(diagnos|report|evidence|trace)/i.test(file);
    const video = /\.(mp4|webm)$/i.test(entry.name) && s.size >= 16 * 1024 ** 2;
    if ((binary || archive || video) && s.size >= 1024 ** 2) {
      const preserve = rel.startsWith("full-regression-20261017-01" + path.sep + "candidate-02" + path.sep)
        || rel.startsWith("full-regression-20261017-01" + path.sep + "checkpoint" + path.sep + "artifacts" + path.sep);
      report.targets.push({ path: file, kind: "OUTPUT_GENERATED_FILE",
        reason: video ? "Generated test recording; report retained" : "Generated binary/package duplicate; reports retained",
        bytes: s.size, files: 1, modifiedMs: s.mtimeMs, archiveBeforeDelete: preserve,
        sha256: preserve ? hash(file) : null });
    }
  }
}
report.outputDiscovery = { pendingDirectories: queue.length,
  pendingPaths: queue, completeWithinPrunedScope: queue.length === 0, maxFiles: 600000 };
report.largestOutputGroups = Object.entries(topTotals).sort((a, b) => b[1] - a[1]).slice(0, 20);

// The known _MEI903002 belongs to the recorded, already-terminated test backend PID90300.
// Only matching runtime fingerprints qualify; different PyInstaller apps are not swept.
const knownRuntime = path.join(temp, "_MEI903002");
const fingerprintNames = ["base_library.zip", "python311.dll", "sqlite_vec/vec0.dll",
  "numpy/_core/_multiarray_umath.cp311-win_amd64.pyd"];
if (mode === "all") {
report.runtimeFingerprint = fingerprintNames.filter(rel => fs.existsSync(path.join(knownRuntime, rel)))
  .map(rel => ({ rel, sha256: hash(path.join(knownRuntime, rel)) }));
assert(report.runtimeFingerprint.length >= 3);
const cDeadline = Date.now() + 90000;
for (const entry of fs.readdirSync(temp, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^_MEI\d+$/.test(entry.name)) continue;
  const dir = path.join(temp, entry.name);
  try {
    if (!report.runtimeFingerprint.every(item => fs.existsSync(path.join(dir, item.rel))
      && hash(path.join(dir, item.rel)) === item.sha256)) {
      report.skipped.push({ path: dir, reason: "Different or incomplete PyInstaller runtime fingerprint" }); continue;
    }
    directoryTarget(dir, "Orphan test-backend runtime with matching recorded fingerprint",
      "C_BACKEND_RUNTIME", cDeadline);
  } catch (error) { report.skipped.push({ path: dir, reason: String(error.message) }); }
}
}
report.logicalBytes = report.targets.reduce((sum, t) => sum + t.bytes, 0);
report.logicalBytesByDrive = Object.fromEntries(["C", "D"].map(drive => [drive,
  report.targets.filter(t => t.path[0].toUpperCase() === drive).reduce((sum, t) => sum + t.bytes, 0)]));
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "inventory.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ targets: report.targets.length, bytesByDrive: report.logicalBytesByDrive,
  discovery: { ...report.outputDiscovery, pendingPaths: undefined },
  skipped: report.skipped.length, excludedDeepContinuationRoots: report.excludedDeepContinuationRoots || 0,
  largest: report.largestOutputGroups.slice(0, 10) }));
