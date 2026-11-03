"use strict";
// Independent readback of real installed IO evidence; no application launch.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Editor-Repair-Release-20261024-01";
const attempt = process.argv[2], sourceAttempt = process.argv[3];
for (const v of [attempt, sourceAttempt]) assert.match(v || "", /^\d{2}$/);
const out = path.join(base, `directory-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const check = f => assert.equal(sha(f.path), f.sha256, f.path);
const normalizeAcl = s => s.replace(/D:AI(?=\(|$)/, "D:");
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
  scope: "INSTALLED_1_9_23_DIRECTORY_IO_ONLY_NOT_PICKER_OR_UPGRADE", modelRequests: 0 };
function terminal(r) {
  assert.equal(r.status, "PASS"); assert.equal(r.cases.length, 12);
  assert.deepEqual(r.errors, []); assert(!r.cleanupError);
  assert.equal(r.modelRequests, 0); assert.equal(r.restoration.status, "RESTORED");
  assert.equal(normalizeAcl(r.restoration.before), normalizeAcl(r.restoration.sddl));
  assert.equal(r.denial.status, "DENIED"); assert.notEqual(r.denial.after, r.denial.before);
  const matrix = new Set();
  for (const c of r.cases) {
    assert.equal(c.status, "PASS"); assert(c.noFallbackNoPartialNoOverwrite);
    assert(c.summary.includes("PROJECT_EXPORT_DIRECTORY_WRITE_FAILED"));
    assert(c.summary.includes(r.restoration.directory));
    assert(!c.summary.includes("请确认素材仍可在素材库中预览"));
    assert(c.geometry.hit && c.geometry.overflow <= 1);
    matrix.add([c.width, c.height, c.dpr, c.reduced].join("/"));
  }
  assert.equal(matrix.size, 12); assert.equal(r.screenshots.length, 12);
  assert.equal(r.cleanups.length, 1); assert.equal(r.cleanups[0].status, "PASS");
  assert.equal(r.cleanups[0].normalCloseClaimed, false);
  assert(r.sourceFailure.error.includes("无法读取素材"));
  assert(!r.sourceFailure.error.includes("PROJECT_EXPORT_DIRECTORY_"));
}
(async () => {
  const source = path.join(base, `directory/green-${sourceAttempt}/report.json`), r = read(source);
  terminal(r);
  assert.equal(r.scope, "ACTUAL_INSTALLED_1_9_23_REAL_ACL_AND_RUST_IO_NOT_NATIVE_PICKER_ACCEPTANCE");
  const installation = read(path.join(base, "installation.json"));
  assert.equal(installation.executable.version, "1.9.23");
  for (const f of [r.executable, r.installation, r.input, r.old, r.retryPackage, ...r.sources,
    installation.executable, ...installation.resources, ...installation.protectedFiles]) check(f);
  assert.equal(r.executable.sha256, installation.executable.sha256);
  for (const c of r.cases) {
    check(c.error);
    assert.equal(fs.readFileSync(c.error.path, "utf8").split("== Developer Diagnosis ==")[0], c.summary);
  }
  for (const s of r.screenshots) {
    check(s); assert.deepEqual(s.before, s.after);
    const bytes = fs.readFileSync(s.path);
    assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
    assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(r.retryPackage.path));
  const project = JSON.parse(await zip.file("project.json").async("string"));
  assert(project.project_id.startsWith("directory-write-green-"));
  assert.equal(project.nodes.length, 2); assert.equal(project.edges.length, 1);
  assert(!JSON.stringify(project).includes("projectExportDirectories"));
  assert.deepEqual(fs.readdirSync(r.restoration.directory).sort(),
    ["old.vnproj", path.basename(r.retryPackage.path)].sort());
  report.checks.push({ name: "installed-hashes-errors-PNG-and-retry-ZIP-readback", status: "PASS" });
  const target = r.restoration.directory.replace(/'/g, "''");
  const actual = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " +
    "([IO.Directory]::GetAccessControl('" + target + "')).GetSecurityDescriptorSddlForm(" +
    "[Security.AccessControl.AccessControlSections]::All)"],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(normalizeAcl(actual.stdout.trim()), normalizeAcl(r.restoration.before));
  const live = rows();
  assert(!(r.knownProcesses || []).some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
  const ports = r.launches.flatMap(l => l.ports); assert.equal(listeners(ports).length, 0);
  report.checks.push({ name: "actual-restored-ACL-no-owned-process-or-port", status: "PASS", ports });
  const originalFailure = path.join(base, "directory/green-01/report.json"), failure = read(originalFailure);
  assert.equal(failure.status, "FAILED"); assert.equal(failure.cases.length, 0);
  report.originalFailure = { path: originalFailure, sha256: sha(originalFailure) };
  report.rejected = [];
  for (const [name, mutate] of [
    ["empty", v => v.cases = []],
    ["duplicate", v => v.cases[1] = structuredClone(v.cases[0])],
    ["failed", v => v.cases[0].status = "FAILED"],
    ["missing-restore", v => v.restoration.status = "DENIED"],
    ["missing-PNG", v => v.screenshots.pop()],
    ["wrong-source-error", v => v.sourceFailure.error = "PROJECT_EXPORT_DIRECTORY_WRITE_FAILED"],
    ["cleanup-failure", v => v.cleanups[0].status = "FAILED"],
  ]) {
    const invalid = structuredClone(r); mutate(invalid); assert.throws(() => terminal(invalid));
    report.rejected.push(name);
  }
  report.checks.push({ name: "seven-incomplete-evidence-controls-rejected", status: "PASS" });
  report.source = { path: source, sha256: sha(source) }; report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, checks: report.checks.length, error: report.error }));
});
