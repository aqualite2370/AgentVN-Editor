"use strict";
// Normalize evidence schemas without manufacturing another installation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
function validate(derived) {
  assert.equal(derived.scope, "SCHEMA_ADAPTER_OF_EXISTING_ACTUAL_NSIS_INSTALLATION_NOT_A_NEW_INSTALLATION");
  assert.equal(sha(derived.sourceReceipt.path), derived.sourceReceipt.sha256);
  const source = read(derived.sourceReceipt.path);
  for (const key of ["status", "version", "installer", "installRoot", "executable", "exitCode", "metadataRestoration"])
    assert.deepEqual(derived[key], source[key], key);
  assert.equal(source.status, "PASS"); assert.equal(source.exitCode, 0);
  assert.equal(source.metadataRestoration, "PASS");
  assert(source.actualRegistration && Array.isArray(source.actualRegistration.values));
  assert(source.actualRegistration.values.length > 0);
  assert.equal(derived.registryRestored, true);
  const installed = verifiedInstalledCandidate(derived.sourceReceipt.path);
  for (const item of [source.installer, installed.executable, ...(installed.resources || [])])
    assert.equal(sha(item.path), item.sha256);
  return { sourceReceipt: derived.sourceReceipt, executable: installed.executable,
    installer: source.installer, newInstallations: 0 };
}
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  assert(input && output && !fs.existsSync(output));
  const relative = path.relative(path.resolve("F:/AgentVN/QA"), path.resolve(output));
  assert(relative && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..");
  const result = { status: "RUNNING", startedAt: new Date().toISOString(),
    source: describe(input), test: describe(__filename), productChanges: 0, modelRequests: 0 };
  try {
    const value = read(input);
    Object.assign(result, validate(value));
    const changes = [
      d => { d.scope = "NEW_INSTALLATION"; }, d => { d.sourceReceipt.sha256 = "0".repeat(64); },
      d => { d.executable.sha256 = "0".repeat(64); }, d => { d.version = "9.9.9"; },
      d => { d.metadataRestoration = "FAILED"; }, d => { d.registryRestored = false; },
      d => { d.installer.path = __filename; }, d => { d.exitCode = 1; },
    ];
    for (const change of changes) {
      const bad = structuredClone(value); change(bad);
      assert.throws(() => validate(bad), assert.AssertionError);
    }
    result.rejectedFalseProvenance = changes.length;
    result.status = "PASS";
  } catch (error) {
    result.status = "FAILED"; result.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify(result));
  }
}
module.exports = { validate };
