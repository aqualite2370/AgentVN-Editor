"use strict";
// Minimal filesystem diagnostic, not an Editor/Android feature PASS.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const qa = "F:/AgentVN/QA/Android-Package-20261021-01/rename-01";
const alias = "C:/Users/1/AppData/Local/Temp/agentvn-android-rename-20261021-01";
assert(!fs.existsSync(qa) && !fs.existsSync(alias), "Fresh exact diagnostic paths required");
fs.mkdirSync(qa); fs.symlinkSync(qa, alias, "junction");
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "OWNED_FILESYSTEM_MARKERS_ONLY",
  cases: [], inputActions: 0, productChanges: 0, cleanup: null };
try {
  for (const [name, fromRoot, toRoot] of [["physical", qa, qa], ["junction", alias, alias],
    ["physical-to-alias", qa, alias], ["alias-to-physical", alias, qa]]) {
    const source = path.join(fromRoot, name + "-uploads/source"), target = path.join(toRoot, name + "-target");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "marker.txt"), "AgentVN QA rename marker", { flag: "wx" });
    const row = { name, source, target, physicalSource: fs.realpathSync.native(source), sourceExists: fs.existsSync(source) };
    report.cases.push(row);
    try { fs.renameSync(source, target); assert.equal(fs.readFileSync(path.join(target, "marker.txt"), "utf8"), "AgentVN QA rename marker"); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e); }
  }
  report.status = "OBSERVED";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  try {
    assert(fs.lstatSync(alias).isSymbolicLink());
    assert.equal(fs.realpathSync.native(alias).toLowerCase(), path.resolve(qa).toLowerCase());
    // Exact owned junction only; no recursive delete, all marker bytes remain on F.
    fs.rmdirSync(alias); assert(!fs.existsSync(alias)); report.cleanup = "PASS";
  } catch (e) { report.cleanup = "FAILED"; report.cleanupError = String(e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(qa, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
}
console.log(JSON.stringify(report, null, 2));
