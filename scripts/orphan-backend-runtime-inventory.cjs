"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const [excludeArg, outArg] = process.argv.slice(2);
assert(excludeArg && outArg && !fs.existsSync(outArg));
const previous = JSON.parse(fs.readFileSync(excludeArg, "utf8"));
const excluded = new Set(previous.targets.map(t => t.path.toLowerCase()));
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const result = { status: "INVENTORY_ONLY", root: previous.root,
  startedAt: new Date().toISOString(), targets: [], protectedFiles: previous.protectedFiles,
  runtimeFingerprint: previous.runtimeFingerprint, skipped: [], provenanceDiscovery: {} };
const queue = [{ p: previous.root, depth: 0 }], known = new Set();
const deadline = Date.now() + 30000; let visited = 0;
function count(root) {
  const dirs = [root]; let bytes = 0, files = 0;
  while (dirs.length) {
    const dir = dirs.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, entry.name), s = fs.lstatSync(f);
      assert(!s.isSymbolicLink());
      if (s.isDirectory()) dirs.push(f); else { bytes += s.size; files++; }
    }
  }
  return { bytes, files };
}
while (queue.length && Date.now() < deadline) {
  const dir = queue.pop(); let entries; visited++;
  try { entries = fs.readdirSync(dir.p, { withFileTypes: true }); } catch { continue; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const f = path.join(dir.p, entry.name);
    if (entry.isDirectory()) {
      if (dir.depth < 8 && !/^(node_modules|target|resources|GameCli_framework|webview|EBWebView|Cache|Code Cache|GPUCache|\.git|files|assets|Windows|PFiles)$/i.test(entry.name))
        queue.push({ p: f, depth: dir.depth + 1 });
    } else if (entry.name === "installed-processes.json") {
      try {
        const record = JSON.parse(fs.readFileSync(f, "utf8"));
        if (!Number.isInteger(record.backendPid)) continue;
        const runtime = path.join("C:/Users/1/AppData/Local/Temp", `_MEI${record.backendPid}2`);
        if (excluded.has(runtime.toLowerCase()) || known.has(runtime) || !fs.existsSync(runtime)) continue;
        const born = fs.statSync(runtime).birthtimeMs;
        const delta = Math.abs(born - Date.parse(record.startedAt));
        if (!Number.isFinite(delta) || delta > 60000) {
          result.skipped.push({ path: runtime, reason: "PID evidence and directory creation time do not agree" }); continue;
        }
        const names = ["base_library.zip", "python311.dll", "sqlite_vec/vec0.dll"];
        const fingerprint = names.map(rel => ({ rel, sha256: hash(path.join(runtime, rel)) }));
        assert.equal(fingerprint[1].sha256, "2835e0f24fb13ef019608b13817f3acf8735fbc5f786d00501c4a151226bdff1");
        assert.equal(fingerprint[2].sha256, "fcf98662a7ad9dce394b96a88f91032047823831b951c76636787c312a6476e6");
        result.targets.push({ path: runtime, kind: "C_BACKEND_RUNTIME", ...count(runtime),
          reason: "Exact historical backend PID, creation-time and library identity agree",
          runtimeFingerprint: fingerprint, provenance: f, backendPid: record.backendPid,
          startedAt: record.startedAt, creationTimeDifferenceMs: delta });
        result.protectedFiles.push({ path: f, sha256: hash(f) });
        known.add(runtime);
      } catch (error) { result.skipped.push({ path: f, reason: String(error.message) }); }
    }
  }
}
result.provenanceDiscovery = { visited, pending: queue.length, completeWithinPrunedScope: queue.length === 0 };
result.logicalBytes = result.targets.reduce((s, t) => s + t.bytes, 0);
result.finishedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(outArg), { recursive: true });
fs.writeFileSync(outArg, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ targets: result.targets.length, bytes: result.logicalBytes,
  discovery: result.provenanceDiscovery, skipped: result.skipped.length }));
