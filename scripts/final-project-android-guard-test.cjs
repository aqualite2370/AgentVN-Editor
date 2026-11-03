"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const directory = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(directory), "Fresh evidence directory required");
fs.mkdirSync(directory, { recursive: true });
const report = { status: "RUNNING", checks: [], startedAt: new Date().toISOString() };
function test(name, action) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { action(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; throw e; }
}
try {
  const { validateExportTarget } = require("./lib/android-export-target.cjs");
  test("Small fixture title remains allowed without final-project authorization", () => {
    assert.equal(validateExportTarget({ title: "隔离小工程" }).scope, "isolated-project");
  });
  test("Final project is rejected without explicit verified authorization", () => {
    assert.throws(() => validateExportTarget({ title: "隐忍的成长" }), /FINAL_PROJECT_PROOF_REQUIRED/);
  });
  test("Missing title is rejected", () => {
    assert.throws(() => validateExportTarget({ title: "" }), /PROJECT_TITLE_REQUIRED/);
  });
  test("Final proof cannot be applied to a different small project", () => {
    assert.throws(() => validateExportTarget({ title: "隔离小工程", proofFile: __filename }), /FINAL_PROOF_SCOPE_MISMATCH/);
  });
  if (process.argv[3]) {
    const proofFile = path.resolve(process.argv[3]);
    const options = JSON.parse(fs.readFileSync(proofFile, "utf8"));
    test("Final canonical copy requires passing installed Windows terminal evidence", () => {
      const result = validateExportTarget({ title: "隐忍的成长", proofFile,
        projectFile: options.projectFile, sessionRoot: options.sessionRoot });
      assert.equal(result.scope, "final-hidden-growth"); assert.equal(result.assets, 143);
    });
    test("Authorization cannot leak to another project input", () => {
      assert.throws(() => validateExportTarget({ title: "隐忍的成长", proofFile,
        projectFile: __filename, sessionRoot: options.sessionRoot }));
    });
    const negativeDir = path.join(options.sessionRoot, "guard-negative-cases");
    assert(!fs.existsSync(negativeDir)); fs.mkdirSync(negativeDir);
    const sha = require("./lib/installed-acceptance.cjs").sha256;
    test("A nonterminal Windows report cannot authorize final Android export", () => {
      const windows = JSON.parse(fs.readFileSync(options.windowsTerminal.path, "utf8"));
      const badFile = path.join(negativeDir, "unfinished-windows.json");
      const bytes = Buffer.from(JSON.stringify({ ...windows, status: "RUNNING" }));
      fs.writeFileSync(badFile, bytes, { flag: "wx" });
      const badProof = path.join(negativeDir, "unfinished-authorization.json");
      fs.writeFileSync(badProof, JSON.stringify({ ...options,
        windowsTerminal: { path: badFile, sha256: sha(bytes) } }), { flag: "wx" });
      assert.throws(() => validateExportTarget({ title: "隐忍的成长", proofFile: badProof,
        projectFile: options.projectFile, sessionRoot: options.sessionRoot }), /INSTALLED_FINAL_WINDOWS_TERMINAL_AUDIT_PASS/);
    });
    test("Changed authorization evidence hash is rejected", () => {
      const badProof = path.join(negativeDir, "bad-hash-authorization.json");
      fs.writeFileSync(badProof, JSON.stringify({ ...options,
        inputProvenance: { ...options.inputProvenance, sha256: "0".repeat(64) } }), { flag: "wx" });
      assert.throws(() => validateExportTarget({ title: "隐忍的成长", proofFile: badProof,
        projectFile: options.projectFile, sessionRoot: options.sessionRoot }), /FINAL_PROOF_HASH_MISMATCH/);
    });
    const { assertCanonical } = require("./lib/android-hidden-growth-flow.cjs");
    const target = validateExportTarget({ title: "隐忍的成长", proofFile,
      projectFile: options.projectFile, sessionRoot: options.sessionRoot });
    const manifest = JSON.parse(fs.readFileSync(target.resource.manifest.path, "utf8"));
    const script = JSON.parse(fs.readFileSync(target.resource.script.path, "utf8"));
    test("Actual Windows cartridge has the final canonical identity and authored scenes", () => assertCanonical(manifest, script));
    test("A small-fixture or substituted identity cannot satisfy the final scope", () => {
      assert.throws(() => assertCanonical({ ...manifest, game_id: "installed_resource_flow_other" }, script));
      assert.throws(() => assertCanonical({ ...manifest, assets: [] }, script));
      assert.throws(() => assertCanonical(manifest, { ...script, scenes: script.scenes.slice(0, 2) }));
    });
  }
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
