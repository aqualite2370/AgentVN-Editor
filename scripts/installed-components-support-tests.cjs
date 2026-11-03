"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), destination = process.argv[2]; assert(destination && !fs.existsSync(destination));
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "CURRENT_FROZEN_SOURCE_SUPPORT_TESTS_NOT_INSTALLATION_PROOF",
  source: [], commands: [], error: null, realModelRequests: 0 };
try {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"), "utf8"));
  for (const relative of ["editor/src/renpy/customComponentMarkup.ts", "editor/src/renpy/customComponentArchive.ts",
    "editor/src/renpy/customComponentProject.ts", "editor/src/renpy/personalComponentLibrary.ts", "shared/cartridge/customComponent.ts"]) {
    const file = path.join(root, relative), declared = candidate.source.find(r => path.resolve(r.path).toLowerCase() === file.toLowerCase());
    assert(declared); const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(actual, declared.sha256); report.source.push({ relative, sha256: actual });
  }
  for (const script of ["scripts/custom-component-markup-test.cjs", "scripts/custom-component-archive-test.cjs",
    "scripts/custom-component-project-copy-test.cjs", "scripts/custom-component-project-export-test.cjs"]) {
    const start = new Date().toISOString();
    const result = spawnSync(process.execPath, [script], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000 });
    report.commands.push({ command: `node ${script}`, at: start, finishedAt: new Date().toISOString(),
      status: result.status === 0 ? "PASS" : "FAILED", exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.status, 0, script); assert(result.stdout.includes("PASS"), "Nonempty test result required");
  }
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString(); fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, tests: report.commands.length, sourceFiles: report.source.length, error: report.error }, null, 2));
