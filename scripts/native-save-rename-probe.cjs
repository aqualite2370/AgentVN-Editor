"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const out = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/rename-probe-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const local = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-save-rename-"));
const target = path.join(out, "junction-target"), junction = path.join(local, "link");
fs.mkdirSync(target); fs.symlinkSync(target, junction, "junction");
const roots = [path.join(out, "direct-f"), path.join(local, "direct-c"), path.join(junction, "via-c-junction")];
const report = { status: "RUNNING", at: new Date().toISOString(), local, roots, cases: [],
  scope: "SCRATCH_FILESYSTEM_TOPOLOGY_DIAGNOSTIC_NOT_PRODUCT_SAVE_ACCEPTANCE", productChanges: 0 };
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
try {
  for (const [index, root] of roots.entries()) {
    fs.mkdirSync(root, { recursive: true });
    const source = path.join(root, `node-${index}.tmp`), destination = path.join(root, `node-${index}.json`);
    fs.writeFileSync(source, '{"probe":"isolated-atomic-save"}', { flag: "wx" });
    const row = { engine: "node", index, source, destination };
    try { fs.renameSync(source, destination); row.status = "PASS"; row.sha256 = sha(destination); }
    catch (error) { row.status = "FAILED"; row.error = String(error); }
    report.cases.push(row);
  }
  const msvc = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/resolve-msvc-environment.ps1", "-Json"], { encoding: "utf8", windowsHide: true });
  assert.equal(msvc.status, 0);
  const environment = JSON.parse(msvc.stdout.replace(/^\uFEFF/, "")).environment;
  const fixture = path.resolve("scripts/fixtures/native-save-rename-probe.rs");
  const executable = path.join(out, "rename-probe.exe");
  const compiled = spawnSync("rustc", ["--edition=2021", fixture, "-o", executable],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, ...environment } });
  report.compile = { code: compiled.status, stdout: compiled.stdout, stderr: compiled.stderr,
    source: fixture, sourceSha256: sha(fixture) };
  assert.equal(compiled.status, 0, compiled.stderr);
  const run = spawnSync(executable, roots, { encoding: "utf8", windowsHide: true });
  report.rust = { code: run.status, stdout: run.stdout, stderr: run.stderr, exeSha256: sha(executable) };
  report.status = "DIAGNOSTIC_RECORDED";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  // Keep tiny scratch files as evidence; remove only the exact owned junction.
  assert(fs.lstatSync(junction).isSymbolicLink());
  assert.equal(fs.realpathSync(junction), fs.realpathSync(target)); fs.rmdirSync(junction);
  report.finishedAt = new Date().toISOString();
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync("scripts/fixtures/native-save-rename-probe.rs", path.join(out, "executed-probe.rs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
