"use strict";
// Inventory only. Actual deletion is performed by native PowerShell against this manifest.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "../output");
const NAMES = new Set(["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache",
  "DawnWebGPUCache", "GrShaderCache", "ShaderCache"]);
const protectedNames = new Set(["checkpoints", "continuation-checkpoints", "renpy-checkpoint",
  "cleanup-preserved-20261012", "final-hidden-growth-installed-20261017-01",
  "novel-card-position-release-20261017-01"]);
function inside(root, p) {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
function allowed(root, p) {
  if (!inside(root, p)) return false;
  const parts = path.relative(root, p).split(path.sep);
  if (parts.some(s => protectedNames.has(s) || s.startsWith("cleanup-audit-"))) return false;
  const i = parts.lastIndexOf("EBWebView");
  if (i < 1 || !NAMES.has(parts.at(-1))) return false;
  const tail = parts.slice(i + 1);
  return tail.length === 1 || tail.length === 2 && ["Default", "GPUPersistentCache"].includes(tail[0]);
}
function noLinks(root, p) {
  assert(inside(root, p), "Outside output");
  let current = root;
  assert(!fs.lstatSync(root).isSymbolicLink(), "Linked output root");
  for (const part of path.relative(root, p).split(path.sep)) {
    current = path.join(current, part);
    assert(!fs.lstatSync(current).isSymbolicLink(), `Linked target/ancestor: ${current}`);
  }
  assert.equal(fs.realpathSync(p).toLowerCase(), path.resolve(p).toLowerCase(), "Redirected target");
}
function measure(p, deadline) {
  let bytes = 0, files = 0, directories = 0;
  const q = [p];
  while (q.length) {
    assert(Date.now() < deadline, "Inventory time budget reached");
    const dir = q.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      assert(!e.isSymbolicLink(), `Link in cache: ${f}`);
      if (e.isDirectory()) { directories++; q.push(f); }
      else if (e.isFile()) {
        assert(!/\.(?:png|jpe?g|webm|mp4|wav|mp3|apk|exe|msi|vnproj|vncart|zip|db|sqlite|xml|md|log)$/i.test(e.name),
          `Unexpected evidence/user file in cache: ${f}`);
        assert(!/(?:report|acceptance|manifest|diagnostic|provenance).*\.json$/i.test(e.name),
          `Unexpected report in cache: ${f}`);
        files++; assert(files < 20000, "Too many files in a single cache");
        bytes += fs.statSync(f).size;
      } else assert.fail(`Unsupported entry: ${f}`);
    }
  }
  return { bytes, files, directories };
}
function inventory() {
  const started = Date.now(), deadline = started + 60000;
  const report = { schemaVersion: 1, root: ROOT, startedAt: new Date().toISOString(),
    status: "INVENTORY_ONLY", targets: [], skipped: [], discovery: {}, protectedFiles: [] };
  const q = [{ p: ROOT, depth: 0 }];
  let cursor = 0;
  while (cursor < q.length && cursor < 60000 && Date.now() < started + 30000) {
    const { p, depth } = q[cursor++];
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); }
    catch (e) { report.skipped.push({ path: p, reason: e.code }); continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const f = path.join(p, e.name);
      if (protectedNames.has(e.name) || e.name.startsWith("cleanup-audit-")) continue;
      if (e.name === "EBWebView") {
        for (const sub of ["", "Default", "GPUPersistentCache"]) {
          for (const name of NAMES) {
            const candidate = path.join(f, sub, name);
            if (!fs.existsSync(candidate)) continue;
            try {
              assert(allowed(ROOT, candidate)); noLinks(ROOT, candidate);
              const count = measure(candidate, deadline);
              report.targets.push({ path: candidate, profile: f, reason: "Regenerable historical WebView cache", ...count });
            } catch (err) { report.skipped.push({ path: candidate, reason: err.message }); }
          }
        }
        continue; // Never traverse Local Storage, databases or profile history.
      }
      if (["node_modules", "target", ".git", "assets", "resources", "saves"].includes(e.name)) continue;
      if (depth < 13) q.push({ p: f, depth: depth + 1 });
    }
  }
  report.discovery = { visited: cursor, pending: q.length - cursor, bounded: true,
    completeWithinPrunedScope: cursor === q.length, elapsedMs: Date.now() - started };
  const prior = path.join(ROOT, "cleanup-audit-20261017-1124/verification.json");
  const protectedFiles = JSON.parse(fs.readFileSync(prior, "utf8")).protectedFiles
    .filter(p => !/[\\/]plans[\\/]ACTIVE_TASKS\.md$/i.test(p.path)).map(p => p.path);
  for (const rel of ["final-hidden-growth-installed-20261017-01/windows-terminal-audit-01.json",
    "final-hidden-growth-installed-20261017-01/android-device-02/terminal-audit-01.json",
    "final-hidden-growth-installed-20261017-01/android-01/installed-session/android-export/隐忍的成长-0.1.0.apk",
    "final-hidden-growth-installed-20261017-01/android-01/installed-session/android-export/隐忍的成长-0.1.0.apk.acceptance.json",
    "final-hidden-growth-installed-20261017-01/windows-04/installed-session/windows-export/portable/隐忍的成长.exe"]) {
    protectedFiles.push(path.join(ROOT, rel));
  }
  for (const p of [...new Set(protectedFiles)]) {
    report.protectedFiles.push({ path: p,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") });
  }
  report.totalBytes = report.targets.reduce((s, t) => s + t.bytes, 0);
  report.finishedAt = new Date().toISOString();
  return report;
}
module.exports = { allowed, inside, ROOT };
if (require.main === module) {
  assert.equal(process.argv.length, 3, "node output-cache-inventory.cjs <new-manifest>");
  const output = path.resolve(process.argv[2]);
  assert(inside(ROOT, output) && !fs.existsSync(output), "Require fresh report under output");
  const report = inventory();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ file: output, targets: report.targets.length, logicalBytes: report.totalBytes,
    discovery: report.discovery, skipped: report.skipped.length }));
}
