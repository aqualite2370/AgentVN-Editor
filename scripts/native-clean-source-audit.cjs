"use strict";
// Independent read-only verification of the existing compile/test receipts.
const assert = require("node:assert/strict"), fs = require("node:fs");
const path = require("node:path"), crypto = require("node:crypto");
const base = "F:/AgentVN/QA/Source-Delivery-20261103-01";
const number = process.argv[2] || "04"; assert.match(number, /^\d{2}$/);
const out = path.join(base, `native-clean-${number}`);
const auditNumber = process.argv[3] || "01"; assert.match(auditNumber, /^\d{2}$/);
const destination = path.join(out, `audit-${auditNumber}.json`);
assert(!fs.existsSync(destination));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const receipt = path.join(out, "report.json"), report = read(receipt);
const result = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "EXISTING_WINDOWS_NATIVE_SOURCE_BUILD_EVIDENCE_ONLY", groups: [] };
const check = (name, callback) => { callback(); result.groups.push({ name, status: "PASS" }); };
function file(row) {
  assert.equal(fs.statSync(row.path).size, row.bytes);
  assert.equal(sha(row.path), row.sha256, row.path);
}
function command(row) {
  assert(row && row.finishedAt && row.pid > 0);
  assert.equal(row.status, "PASS"); assert.equal(row.exitCode, 0);
  file(row.log);
}
try {
  check("terminal current and referenced stages", () => {
    assert.equal(report.status, "PASS"); assert.equal(report.cleanup, "PASS");
    assert.equal(report.sourceBytesPreserved, true); assert.equal(report.protectedFilesPreserved, true);
    file(report.reusedNativeEnvironment.receipt); file(report.reusedStages.receipt);
    for (const row of report.commands) command(row);
    for (const row of report.reusedStages.commands) command(row);
    assert.equal(report.commands.length, 6);
    assert.deepEqual(report.reusedStages.commands.map(c => c.name),
      ["player-tests", "player-build", "backend-package", "prepare-runtime-resources"]);
    for (const key of ["productChanges", "modelRequests", "devicesStarted", "devReplacements",
      "installersBuilt"]) assert.equal(report[key], 0);
  });
  check("123 executed tests and explicit outstanding manual test", () => {
    const rows = [...report.commands, ...report.reusedStages.commands];
    for (const [name, count, ignored, filtered] of [
      ["player-tests", 29, 0, 0], ["editor-tests", 92, 2, 0],
      ["editor-real-materialization", 1, 0, 93], ["editor-integration", 1, 0, 0],
    ]) {
      const row = rows.find(c => c.name === name);
      assert.equal(row.tests.passed, count); assert.equal(row.tests.ignored.length, ignored);
      assert.equal(row.tests.failed, 0); assert.equal(row.tests.filtered, filtered);
      assert(fs.readFileSync(row.log.path, "utf8").includes(
        `test result: ok. ${count} passed; 0 failed; ${ignored} ignored; 0 measured; ${filtered} filtered out`));
    }
    assert.equal(report.excludedManualTests.length, 1);
    assert.equal(report.excludedManualTests[0].name,
      "native_cartridge::tests::streams_full_imported_project_asset_set");
    assert.equal(report.excludedManualTests[0].status, "NOT_RUN");
  });
  check("frozen product source bytes and existing Dev protection", () => {
    file(report.source); file(report.archive);
    const source = read(report.source.path);
    const frozen = path.join(base, "snapshot-02", "source");
    assert.equal(source.files.length, 3553);
    for (const entry of source.files)
      assert.equal(sha(path.join(frozen, entry.relative)), entry.sha256, entry.relative);
    for (const row of report.protectedFiles) {
      if (row.absent) assert(!fs.existsSync(row.path)); else file(row);
    }
    file(report.frontendGates); assert.equal(read(report.frontendGates.path).status, "PASS");
    file(report.backendGates); assert.equal(read(report.backendGates.path).status, "PASS");
  });
  check("three real x64 Windows GUI executables", () => {
    assert.equal(report.artifacts.length, 3);
    for (const artifact of report.artifacts) {
      file(artifact);
      const buffer = fs.readFileSync(artifact.path), offset = buffer.readUInt32LE(0x3c);
      assert.equal(buffer.toString("ascii", 0, 2), "MZ");
      assert.equal(buffer.toString("ascii", offset, offset + 4), "PE\0\0");
      assert.equal(buffer.readUInt16LE(offset + 4), 0x8664);
      assert.equal(buffer.readUInt16LE(offset + 24 + 68), 2);
    }
    const auditFile = path.join(base, "native-clean-03", "backend-source-audit.json");
    const audit = read(auditFile);
    assert.equal(audit.status, "PASS"); assert.equal(audit.appModules, 71);
    assert.equal(audit.launcherModules, 1);
    assert.equal(audit.applicationCodeExecuted, false);
    assert(audit.modules.every(m => m.codeObjectEqual && m.status === "PASS"));
    assert.equal(audit.sha256, report.artifacts.find(a => a.path.endsWith("creator-backend.exe")).sha256);
    result.backendSourceAudit = { path: auditFile, sha256: sha(auditFile),
      omittedModules: audit.unpackagedSourceModules.map(m => m.module) };
  });
  check("bundled helpers/resources and real materialization", () => {
    const frozen = path.join(base, "snapshot-02", "source");
    const bundled = path.join(frozen, "editor", "src-tauri", "bundle-workspace");
    const manifest = read(path.join(frozen, "scripts", "standalone-build-scripts.json"));
    assert.equal(manifest.schemaVersion, 1);
    const names = manifest.scripts;
    assert(names.length > 0);
    assert.equal(new Set(names).size, names.length);
    for (const required of ["verify-vncart.cjs", "unpack-vncart.cjs",
      "build-runtime-standalone-windows.cjs", "build-runtime-standalone-android.cjs"])
      assert(names.includes(required));
    for (const name of names)
      assert.equal(sha(path.join(bundled, "scripts", name)), sha(path.join(frozen, "scripts", name)));
    assert.equal(sha(path.join(bundled, "GameCli_framework/src-tauri/src/lib.rs")),
      sha(path.join(frozen, "GameCli_framework/src-tauri/src/lib.rs")));
    const materialized = path.join(out, "materialized-workspace");
    assert.equal(read(path.join(materialized, "build-versions.json")).editorVersion, "1.9.40");
    assert(!fs.existsSync(path.join(materialized, "editor")));
    assert(fs.existsSync(path.join(materialized, "GameCli_framework/node_modules/sharp/dist/index.cjs")));
    result.bundledBuildHelpers = names.length;
  });
  check("prior failures preserved and owned junction removed", () => {
    for (const n of ["01", "02", "03"])
      assert.equal(read(path.join(base, `native-clean-${n}`, "report.json")).status, "FAILED");
    const former = read(path.join(base, "native-clean-03", "report.json"));
    assert.equal(former.junction.cleanup, "PASS");
    assert(!fs.existsSync(former.junction.path));
    for (const entry of former.junction.files) file(entry);
    assert.deepEqual(former.junction.files.map(f => path.basename(f.path)).sort(),
      ["auto-01.json", "quick-01.json", "slot-01.json"]);
  });
  result.status = "PASS";
  result.reportSha256 = sha(receipt);
} catch (error) {
  result.status = "FAILED"; result.error = String(error.stack || error); process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
}
